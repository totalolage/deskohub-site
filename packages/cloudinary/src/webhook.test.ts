import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

const verifyNotificationSignature = mock(() => true);
const cloudinary = {
  config: mock(() => undefined),
  utils: { verifyNotificationSignature },
};

mock.module("cloudinary", () => ({ v2: cloudinary }));

const { makeCloudinaryRuntimeConfigLayer } = await import("./config");
const { CloudinaryWebhookVerifier, verifyCloudinaryWebhookRequest } =
  await import("./webhook");

const originalNow = Date.now;
const now = Date.parse("2026-06-20T10:00:00Z");
const timestamp = Math.floor(now / 1000);
const config = {
  cloudName: "cloud-name",
  apiKey: "api-key",
  apiSecret: "api-secret",
};

beforeEach(() => {
  Date.now = () => now;
  verifyNotificationSignature.mockReset();
  verifyNotificationSignature.mockReturnValue(true);
  cloudinary.config.mockClear();
});

afterEach(() => {
  Date.now = originalNow;
});

const request = (body: string, overrides: Record<string, string> = {}) =>
  new Request("https://example.test/cloudinary", {
    method: "POST",
    headers: {
      "x-cld-signature": "signature",
      "x-cld-timestamp": String(timestamp),
      ...overrides,
    },
    body,
  });

const verifyRequest = (request: Request) =>
  verifyCloudinaryWebhookRequest(request).pipe(
    Effect.provide(CloudinaryWebhookVerifier.Live),
    Effect.provide(makeCloudinaryRuntimeConfigLayer(config))
  );

describe("verifyCloudinaryWebhookRequest", () => {
  test("returns payload and timestamp for a valid request", async () => {
    const body = JSON.stringify({ public_id: "gallery/image" });

    const result = await Effect.runPromise(verifyRequest(request(body)));

    expect(result).toEqual({
      payload: { public_id: "gallery/image" },
      timestamp,
    });
    expect(verifyNotificationSignature).toHaveBeenCalledWith(
      body,
      timestamp,
      "signature"
    );
  });

  test("rejects stale timestamps", async () => {
    const result = await Effect.runPromise(
      verifyRequest(
        request("{}", { "x-cld-timestamp": String(timestamp - 301) })
      ).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryWebhookAuthError");
    }
    expect(verifyNotificationSignature).not.toHaveBeenCalled();
  });

  test("rejects bad signatures", async () => {
    verifyNotificationSignature.mockReturnValue(false);

    const result = await Effect.runPromise(
      verifyRequest(request("{}")).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryWebhookAuthError");
    }
  });
});
