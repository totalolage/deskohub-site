import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import type { MobileUpdatePublication } from "../mobile-update-publication";
import { MobileUpdatePublishConfig } from "./mobile-update-publish-config";
import { MobileUpdatesDeployment } from "./mobile-updates-deployment.service";

const rollback: MobileUpdatePublication = {
  type: "rollBackToEmbedded",
  id: "5b3c1d0e-7a2f-4c6b-9e8d-1f2a3b4c5d6e",
  platform: "android",
  runtimeVersion: "rv",
};

/** A body that never finishes arriving. */
const stalledBody = () =>
  new Response(new ReadableStream({ start: () => undefined }), {
    headers: { "content-type": "multipart/mixed; boundary=b" },
  });

/** A deployment whose answers come, in order, from `answers`. */
const deployment = (answers: ReadonlyArray<() => Response>) => {
  const requests: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
    const answer = answers[requests.length - 1];
    if (answer === undefined) throw new Error("No answer left");
    return answer();
  };
  const layer = MobileUpdatesDeployment.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(MobileUpdatePublishConfig, {
          target: new URL("https://workspace.test"),
          blobToken: Option.none(),
          publishToken: Redacted.make("synthetic-publish-token"),
          protectionBypass: Option.none(),
        }),
        Layer.succeed(FetchHttpClient.Fetch, fetch as typeof globalThis.fetch)
      )
    )
  );
  const run = <A, E>(
    use: (service: MobileUpdatesDeployment["Service"]) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      withInstantSleeps(
        Effect.result(
          MobileUpdatesDeployment.pipe(
            Effect.flatMap(use),
            Effect.provide(layer)
          )
        )
      )
    );
  return { requests, run };
};

describe("the deployment's mobile update routes", () => {
  test("retry an update check whose body stalls", async () => {
    const { requests, run } = deployment([
      stalledBody,
      () =>
        new Response("served", {
          headers: { "content-type": "multipart/mixed; boundary=b" },
        }),
    ]);

    const result = await run((service) =>
      service.checkForUpdate({ platform: "ios", runtimeVersion: "rv" })
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: { body: "served" },
    });
    expect(requests).toHaveLength(2);
  });

  test("record a publication after a transient server failure", async () => {
    const { requests, run } = deployment([
      () => new Response(null, { status: 503 }),
      () => Response.json({ status: "published" }, { status: 201 }),
    ]);

    const result = await run((service) => service.publish(rollback));

    expect(result).toMatchObject({ _tag: "Success", success: "published" });
    expect(requests).toEqual([
      "POST /api/mobile/updates",
      "POST /api/mobile/updates",
    ]);
  });

  test.each([409, 501])(
    "give up at once on a publication answered with HTTP %d",
    async (status) => {
      const { requests, run } = deployment([
        () => new Response(null, { status }),
      ]);

      const result = await run((service) => service.publish(rollback));

      expect(result._tag).toBe("Failure");
      expect(requests).toHaveLength(1);
    }
  );
});
