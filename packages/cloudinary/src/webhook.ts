import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { Context, Data, Effect, Layer } from "effect";
import {
  type CloudinaryConfig,
  CloudinaryRuntimeConfig,
  validateCloudinaryRuntimeConfig,
} from "./config";

export class CloudinaryWebhookAuthError extends Data.TaggedError(
  "CloudinaryWebhookAuthError"
)<{ readonly message: string }> {}

export class CloudinaryWebhookValidationError extends Data.TaggedError(
  "CloudinaryWebhookValidationError"
)<{
  readonly message: string;
  readonly payload?: string;
  readonly cause?: unknown;
}> {}

export interface VerifiedCloudinaryWebhook {
  readonly payload: unknown;
  readonly timestamp: number;
}

const DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export interface ICloudinaryWebhookVerifier {
  readonly verify: (
    request: Request
  ) => Effect.Effect<
    VerifiedCloudinaryWebhook,
    CloudinaryWebhookAuthError | CloudinaryWebhookValidationError
  >;
}

export class CloudinaryWebhookVerifier extends Context.Service<
  CloudinaryWebhookVerifier,
  ICloudinaryWebhookVerifier
>()("@deskohub/cloudinary/CloudinaryWebhookVerifier") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const rawConfig = yield* CloudinaryRuntimeConfig;
      const config = yield* validateCloudinaryRuntimeConfig(rawConfig);

      return {
        verify: (request) =>
          verifyCloudinaryWebhookRequestWithConfig(request, config),
      } satisfies ICloudinaryWebhookVerifier;
    })
  );
}

function readRequiredCloudinaryHeaders(request: Request) {
  const signature = request.headers.get("x-cld-signature");
  const timestampHeader = request.headers.get("x-cld-timestamp");

  if (!signature || !timestampHeader) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: missing headers",
        {
          hasSignature: !!signature,
          hasTimestamp: !!timestampHeader,
        }
      );
      return yield* new CloudinaryWebhookAuthError({
        message: "Missing signature or timestamp",
      });
    });
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: invalid timestamp"
      );
      return yield* new CloudinaryWebhookAuthError({
        message: "Invalid timestamp",
      });
    });
  }

  return Effect.succeed({ signature, timestamp });
}

function validateCloudinaryTimestampFreshness(
  timestamp: number,
  timestampToleranceSeconds = DEFAULT_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
) {
  const currentUnixTimestampSeconds = Math.floor(Date.now() / 1000);
  const timestampSkewSeconds = timestamp - currentUnixTimestampSeconds;
  const timestampSkewMagnitudeSeconds = Math.abs(timestampSkewSeconds);

  if (timestampSkewMagnitudeSeconds > timestampToleranceSeconds) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: stale timestamp"
      );
      return yield* new CloudinaryWebhookAuthError({
        message: "Webhook timestamp is outside the allowed freshness window",
      });
    });
  }

  return Effect.void;
}

function readCloudinaryWebhookBody(request: Request) {
  return Effect.tryPromise({
    try: () => request.text(),
    catch: (error) =>
      new CloudinaryWebhookValidationError({
        message: "Failed to read webhook request body",
        cause: error,
      }),
  });
}

function verifyCloudinarySignature(
  bodyText: string,
  timestamp: number,
  signature: string,
  apiSecret: string
) {
  if (!isCloudinarySignature({ apiSecret, bodyText, signature, timestamp })) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: invalid signature"
      );
      return yield* new CloudinaryWebhookAuthError({
        message: "Invalid signature",
      });
    });
  }

  return Effect.void;
}

/**
 * Cloudinary signs the raw body, the timestamp, and the API secret with SHA-1.
 * The expected signature comes from this verifier's own secret rather than the
 * SDK's process-wide configuration, and is compared in constant time.
 */
function isCloudinarySignature(input: {
  readonly apiSecret: string;
  readonly bodyText: string;
  readonly signature: string;
  readonly timestamp: number;
}) {
  const expected = createHash("sha1")
    .update(`${input.bodyText}${input.timestamp}${input.apiSecret}`)
    .digest();
  const received = Buffer.from(input.signature, "hex");

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

function parseCloudinaryWebhookPayload(bodyText: string) {
  return Effect.try({
    try: () => JSON.parse(bodyText) as unknown,
    catch: (error) =>
      new CloudinaryWebhookValidationError({
        message: "Invalid JSON payload",
        cause: error,
      }),
  });
}

function verifyCloudinaryWebhookRequestWithConfig(
  request: Request,
  config: CloudinaryConfig
): Effect.Effect<
  VerifiedCloudinaryWebhook,
  CloudinaryWebhookAuthError | CloudinaryWebhookValidationError
> {
  return Effect.gen(function* () {
    yield* Effect.logInfo("Cloudinary webhook verification started");

    const { signature, timestamp } =
      yield* readRequiredCloudinaryHeaders(request);
    yield* Effect.logDebug("Cloudinary webhook headers validated");

    yield* validateCloudinaryTimestampFreshness(
      timestamp,
      config.timestampToleranceSeconds
    );
    yield* Effect.logDebug("Cloudinary webhook timestamp validated");

    const bodyText = yield* readCloudinaryWebhookBody(request);
    yield* Effect.logDebug("Cloudinary webhook body read");

    yield* verifyCloudinarySignature(
      bodyText,
      timestamp,
      signature,
      config.apiSecret
    );
    yield* Effect.logInfo("Cloudinary webhook signature verified");

    const payload = yield* parseCloudinaryWebhookPayload(bodyText);

    const result = {
      payload,
      timestamp,
    } satisfies VerifiedCloudinaryWebhook;

    yield* Effect.logDebug("Cloudinary webhook verified");
    yield* Effect.logInfo("Cloudinary webhook verification succeeded");

    return result;
  }).pipe(
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.logWarning("Cloudinary webhook verification failed", {
        errorType: error._tag,
      })
    )
  );
}

export function verifyCloudinaryWebhookRequest(
  request: Request
): Effect.Effect<
  VerifiedCloudinaryWebhook,
  CloudinaryWebhookAuthError | CloudinaryWebhookValidationError,
  CloudinaryWebhookVerifier
> {
  return Effect.gen(function* () {
    const verifier = yield* CloudinaryWebhookVerifier;
    return yield* verifier.verify(request);
  });
}
