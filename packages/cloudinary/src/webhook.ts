import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Data, Effect } from "effect";
import type { CloudinaryConfig } from "./service";

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

type CloudinaryWebhookConfig = Pick<
  CloudinaryConfig,
  "cloudName" | "apiKey" | "apiSecret"
> & {
  readonly serviceName?: string;
  readonly timestampToleranceSeconds?: number;
};

function readRequiredCloudinaryHeaders(request: Request) {
  const signature = request.headers.get("x-cld-signature");
  const timestampHeader = request.headers.get("x-cld-timestamp");

  if (!signature || !timestampHeader) {
    return Effect.fail(
      new CloudinaryWebhookAuthError({
        message: "Missing signature or timestamp",
      })
    );
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    return Effect.fail(
      new CloudinaryWebhookAuthError({ message: "Invalid timestamp" })
    );
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
    return Effect.fail(
      new CloudinaryWebhookAuthError({
        message: "Webhook timestamp is outside the allowed freshness window",
      })
    );
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

function configureCloudinary(config: CloudinaryWebhookConfig) {
  return Effect.sync(() => {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
    });
  });
}

function verifyCloudinarySignature(
  bodyText: string,
  timestamp: number,
  signature: string
) {
  if (
    !cloudinary.utils.verifyNotificationSignature(
      bodyText,
      timestamp,
      signature
    )
  ) {
    return Effect.fail(
      new CloudinaryWebhookAuthError({ message: "Invalid signature" })
    );
  }

  return Effect.void;
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

export function verifyCloudinaryWebhookRequest(
  request: Request,
  config: CloudinaryWebhookConfig
): Effect.Effect<
  VerifiedCloudinaryWebhook,
  CloudinaryWebhookAuthError | CloudinaryWebhookValidationError
> {
  return Effect.gen(function* () {
    const { signature, timestamp } = yield* readRequiredCloudinaryHeaders(request);
    yield* validateCloudinaryTimestampFreshness(
      timestamp,
      config.timestampToleranceSeconds
    );
    yield* configureCloudinary(config);

    const bodyText = yield* readCloudinaryWebhookBody(request);

    yield* verifyCloudinarySignature(bodyText, timestamp, signature);

    const payload = yield* parseCloudinaryWebhookPayload(bodyText);

    yield* Effect.logDebug("Cloudinary webhook verified", {
      serviceName: config.serviceName,
      cloudName: config.cloudName,
      timestamp,
    });

    return {
      payload,
      timestamp,
    } satisfies VerifiedCloudinaryWebhook;
  });
}
