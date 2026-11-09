import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { retryTransientReads } from "./read-retry";

const url = "https://workspace.deskohub.test/api/customer/account";

/** A client whose attempts answer with `answers` in turn, then repeat the last. */
const scriptedClient = (
  answers: ReadonlyArray<"transport-failure" | number>
) => {
  let attempts = 0;
  const client = HttpClient.make(
    (request: HttpClientRequest.HttpClientRequest) => {
      const answer = answers[Math.min(attempts, answers.length - 1)];
      attempts += 1;
      return answer === "transport-failure"
        ? Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request }),
            })
          )
        : Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, { status: answer })
            )
          );
    }
  );
  return { client: retryTransientReads(client), attempts: () => attempts };
};

const send = (client: HttpClient.HttpClient, method: "get" | "post") =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Effect.result(client[method](url).pipe(Effect.map((r) => r.status)))
    );
    yield* TestClock.adjust("10 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

describe("retryTransientReads", () => {
  test("retries a read once after a transport failure", async () => {
    const { client, attempts } = scriptedClient(["transport-failure", 200]);

    const result = await send(client, "get");

    expect(result._tag).toBe("Success");
    expect(attempts()).toBe(2);
  });

  test("gives up after one retry", async () => {
    const { client, attempts } = scriptedClient(["transport-failure"]);

    const result = await send(client, "get");

    expect(result._tag).toBe("Failure");
    expect(attempts()).toBe(2);
  });

  test("never retries a server answer, 429 and 5xx included", async () => {
    for (const status of [429, 400, 404, 503]) {
      const { client, attempts } = scriptedClient([status]);

      await send(client, "get");

      expect(attempts()).toBe(1);
    }
  });

  test("never retries a write", async () => {
    const { client, attempts } = scriptedClient(["transport-failure", 200]);

    const result = await send(client, "post");

    expect(result._tag).toBe("Failure");
    expect(attempts()).toBe(1);
  });
});
