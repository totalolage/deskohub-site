import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Redacted } from "effect";
import { verifyStandardWebhookRequest } from "./standard-webhook-signature";

// The signed example of the Standard Webhooks specification.
const specExample = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: 1_614_265_330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
} as const;

const specExampleRequest = (
  headers: Partial<Record<string, string | undefined>> = {}
) => {
  const allHeaders = {
    "webhook-id": specExample.id,
    "webhook-timestamp": String(specExample.timestamp),
    "webhook-signature": specExample.signature,
    ...headers,
  };

  return new Request("https://workspace.test/api/webhooks/posthog", {
    method: "POST",
    headers: Object.fromEntries(
      Object.entries(allHeaders).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    ),
    body: specExample.body,
  });
};

const verify = (request: Request, secret: string = specExample.secret) =>
  Effect.runPromise(
    Effect.result(verifyStandardWebhookRequest(request, Redacted.make(secret)))
  );

/** Freezes the wall clock `seconds` after the example's signing time. */
const atSecondsAfterSigning = (seconds: number) =>
  setSystemTime(new Date((specExample.timestamp + seconds) * 1000));

afterEach(() => {
  setSystemTime();
});

describe("verifyStandardWebhookRequest", () => {
  test("accepts the specification's signed example and returns its id and body", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(specExampleRequest());

    expect(result).toEqual(
      expect.objectContaining({
        _tag: "Success",
        success: { id: specExample.id, body: specExample.body },
      })
    );
  });

  test("accepts the secret without its whsec_ prefix", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(
      specExampleRequest(),
      specExample.secret.replace(/^whsec_/, "")
    );

    expect(result._tag).toBe("Success");
  });

  test("accepts a request when any one of several signatures matches", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(
      specExampleRequest({
        "webhook-signature": [
          "v1,c2lnbmVkIHdpdGggYSByZXRpcmVkIHNlY3JldA==",
          "v1a,hnO3f9T8Ytu9HwrXslvumlUpqtNVqkhqw/enGzPCXe5BdqzCInXqYXFymVJaA7AZdpXwVLPo3mNl8EM+m7TBAg==",
          specExample.signature,
        ].join(" "),
      })
    );

    expect(result._tag).toBe("Success");
  });

  test("reports a body that cannot be read apart from a forged request", async () => {
    atSecondsAfterSigning(10);
    const signed = specExampleRequest();
    const request = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: new ReadableStream({
        start: (controller) => controller.error(new Error("connection reset")),
      }),
    });

    const result = await verify(request);

    expect(result).toEqual(
      expect.objectContaining({
        _tag: "Failure",
        failure: expect.objectContaining({
          _tag: "StandardWebhookBodyUnreadable",
        }),
      })
    );
  });

  test("reports an unusable signing secret apart from a forged request", async () => {
    atSecondsAfterSigning(10);

    for (const secret of ["whsec_", "whsec_not base64!"]) {
      const result = await verify(specExampleRequest(), secret);

      expect(result).toEqual(
        expect.objectContaining({
          _tag: "Failure",
          failure: expect.objectContaining({
            _tag: "StandardWebhookSecretInvalid",
          }),
        })
      );
    }
  });

  test.each(["webhook-id", "webhook-timestamp", "webhook-signature"])(
    "rejects a request without the %s header as unsigned",
    async (header) => {
      atSecondsAfterSigning(10);

      const result = await verify(specExampleRequest({ [header]: undefined }));

      expect(result).toEqual(
        expect.objectContaining({
          _tag: "Failure",
          failure: expect.objectContaining({
            _tag: "StandardWebhookRejection",
            reason: "headers-missing",
          }),
        })
      );
    }
  );

  const rejectedAsForged = expect.objectContaining({
    _tag: "Failure",
    failure: expect.objectContaining({
      _tag: "StandardWebhookRejection",
      reason: "verification-failed",
    }),
  });

  test("rejects a signature made with another secret", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(
      specExampleRequest(),
      "whsec_c2lnbmVkIHdpdGggYW5vdGhlciBzZWNyZXQ="
    );

    expect(result).toEqual(rejectedAsForged);
  });

  test("rejects a signature over a different message id", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(
      specExampleRequest({ "webhook-id": "msg_replayed" })
    );

    expect(result).toEqual(rejectedAsForged);
  });

  test.each([
    ["more than five minutes old", 5 * 60 + 1],
    ["more than five minutes in the future", -(5 * 60 + 1)],
  ])(
    "rejects a correctly signed request %s",
    async (_, secondsAfterSigning) => {
      atSecondsAfterSigning(secondsAfterSigning);

      const result = await verify(specExampleRequest());

      expect(result).toEqual(rejectedAsForged);
    }
  );

  test("accepts a correctly signed request at the edge of the five-minute window", async () => {
    for (const secondsAfterSigning of [5 * 60, -5 * 60]) {
      atSecondsAfterSigning(secondsAfterSigning);

      const result = await verify(specExampleRequest());

      expect(result._tag).toBe("Success");
    }
  });

  test("rejects a timestamp that is not a number", async () => {
    atSecondsAfterSigning(10);

    const result = await verify(
      specExampleRequest({ "webhook-timestamp": "yesterday" })
    );

    expect(result).toEqual(rejectedAsForged);
  });
});
