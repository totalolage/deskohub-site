import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { Effect, Layer, Logger, References } from "effect";

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

/** Cloudinary signs the raw body, the timestamp, and the API secret. */
const sign = (body: string, secret = config.apiSecret) =>
  createHash("sha1").update(`${body}${timestamp}${secret}`).digest("hex");

const request = (body: string, overrides: Record<string, string> = {}) =>
  new Request("https://example.test/cloudinary", {
    method: "POST",
    headers: {
      "x-cld-signature": sign(body),
      "x-cld-timestamp": String(timestamp),
      ...overrides,
    },
    body,
  });

const verifyRequest = (request: Request) =>
  verifyCloudinaryWebhookRequest(request).pipe(
    Effect.provide(
      CloudinaryWebhookVerifier.Default.pipe(
        Layer.provide(makeCloudinaryRuntimeConfigLayer(config))
      )
    )
  );

const captureLogs = async <A>(effect: Effect.Effect<A, never, never>) => {
  const logs: { message: unknown; annotations: Record<string, unknown> }[] = [];
  const logger = Logger.make((options) => {
    logs.push({
      message: options.message,
      annotations: {
        ...options.fiber.getRef(References.CurrentLogAnnotations),
      },
    });
  });
  const result = await Effect.runPromise(
    Effect.provideService(
      Effect.provide(effect, Logger.layer([logger])),
      References.MinimumLogLevel,
      "All"
    )
  );

  return { logs, result };
};

describe("verifyCloudinaryWebhookRequest", () => {
  test("returns payload and timestamp for a valid request", async () => {
    const body = JSON.stringify({ public_id: "gallery/image" });

    const result = await Effect.runPromise(verifyRequest(request(body)));

    expect(result).toEqual({
      payload: { public_id: "gallery/image" },
      timestamp,
    });
  });

  test("verifies with the configured secret, not the SDK's global configuration", async () => {
    verifyNotificationSignature.mockReturnValue(false);
    const body = JSON.stringify({ public_id: "gallery/image" });

    const result = await Effect.runPromise(
      verifyRequest(request(body)).pipe(Effect.result)
    );

    expect(result._tag).toBe("Success");
  });

  test("rejects a signature of a different length", async () => {
    const result = await Effect.runPromise(
      verifyRequest(request("{}", { "x-cld-signature": "abc" })).pipe(
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryWebhookAuthError");
    }
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
    const result = await Effect.runPromise(
      verifyRequest(
        request("{}", { "x-cld-signature": sign("{}", "other-secret") })
      ).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryWebhookAuthError");
    }
  });

  test("never logs webhook credentials, signatures, or provider payloads", async () => {
    const identifier = "webhook-asset-id-sentinel";
    const deliveryUrl = `https://cloudinary.test/${identifier}`;
    const body = JSON.stringify({
      public_id: identifier,
      secure_url: deliveryUrl,
    });
    const secretSignature = sign(body);

    const { logs, result } = await captureLogs(
      verifyRequest(request(body, { "x-cld-signature": secretSignature })).pipe(
        Effect.result
      )
    );

    expect(result._tag).toBe("Success");
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(identifier);
    expect(serialized).not.toContain(deliveryUrl);
    expect(serialized).not.toContain(secretSignature);
    expect(serialized).not.toContain(config.apiKey);
    expect(serialized).not.toContain(config.apiSecret);
    expect(serialized).not.toContain(body);
    expect(serialized).toContain("Cloudinary webhook verification succeeded");
  });

  test("logs a fixed category for signature failures without request details", async () => {
    const identifier = "webhook-failure-asset-id-sentinel";
    const providerText = `provider failure for ${identifier}`;
    const secretSignature = "invalid-webhook-signature-sentinel";
    const body = JSON.stringify({
      public_id: identifier,
      error: providerText,
    });

    const { logs, result } = await captureLogs(
      verifyRequest(request(body, { "x-cld-signature": secretSignature })).pipe(
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(identifier);
    expect(serialized).not.toContain(providerText);
    expect(serialized).not.toContain(secretSignature);
    expect(serialized).not.toContain(config.apiKey);
    expect(serialized).not.toContain(config.apiSecret);
    expect(serialized).not.toContain(body);
    expect(serialized).toContain(
      "Cloudinary webhook auth rejected: invalid signature"
    );
    expect(serialized).toContain("CloudinaryWebhookAuthError");
    expect(serialized).toContain("Cloudinary webhook verification failed");
  });
});
