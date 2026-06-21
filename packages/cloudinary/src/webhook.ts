import "server-only";

import { v2 as cloudinary } from "cloudinary";
import { Context, Data, Effect, Layer } from "effect";
import {
  type CloudinaryConfig,
  CloudinaryRuntimeConfig,
  configureCloudinarySdk,
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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const rawConfig = yield* CloudinaryRuntimeConfig;
      const config = yield* validateCloudinaryRuntimeConfig(rawConfig);
      yield* configureCloudinarySdk(config);

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
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({
          message: "Missing signature or timestamp",
        })
      );
    });
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: invalid timestamp",
        {
          timestampHeader,
        }
      );
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({ message: "Invalid timestamp" })
      );
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
        "Cloudinary webhook auth rejected: stale timestamp",
        {
          timestamp,
          timestampToleranceSeconds,
          timestampSkewSeconds,
          timestampSkewMagnitudeSeconds,
        }
      );
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({
          message: "Webhook timestamp is outside the allowed freshness window",
        })
      );
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
  signature: string
) {
  if (
    !cloudinary.utils.verifyNotificationSignature(
      bodyText,
      timestamp,
      signature
    )
  ) {
    return Effect.gen(function* () {
      yield* Effect.logWarning(
        "Cloudinary webhook auth rejected: invalid signature",
        {
          timestamp,
          signature,
        }
      );
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({ message: "Invalid signature" })
      );
    });
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

function verifyCloudinaryWebhookRequestWithConfig(
  request: Request,
  config: CloudinaryConfig
): Effect.Effect<
  VerifiedCloudinaryWebhook,
  CloudinaryWebhookAuthError | CloudinaryWebhookValidationError
> {
  return Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({ config });
    yield* Effect.logInfo("Cloudinary webhook verification started", {
      serviceName: config.serviceName,
      cloudName: config.cloudName,
    });

    const { signature, timestamp } =
      yield* readRequiredCloudinaryHeaders(request);
    yield* Effect.annotateLogsScoped({ signature, timestamp });
    yield* Effect.logDebug("Cloudinary webhook headers validated", {
      timestamp,
    });

    yield* validateCloudinaryTimestampFreshness(
      timestamp,
      config.timestampToleranceSeconds
    );
    yield* Effect.logDebug("Cloudinary webhook timestamp validated", {
      timestamp,
      timestampToleranceSeconds: config.timestampToleranceSeconds,
    });

    const bodyText = yield* readCloudinaryWebhookBody(request);
    yield* Effect.annotateLogsScoped({ bodyText });
    yield* Effect.logDebug("Cloudinary webhook body read", {
      bodyLength: bodyText.length,
    });

    yield* verifyCloudinarySignature(bodyText, timestamp, signature);
    yield* Effect.logInfo("Cloudinary webhook signature verified", {
      timestamp,
    });

    const payload = yield* parseCloudinaryWebhookPayload(bodyText);
    yield* Effect.annotateLogsScoped({ payload });

    const result = {
      payload,
      timestamp,
    } satisfies VerifiedCloudinaryWebhook;

    yield* Effect.annotateLogsScoped({ result });
    yield* Effect.logDebug("Cloudinary webhook verified", {
      serviceName: config.serviceName,
      cloudName: config.cloudName,
      timestamp,
    });
    yield* Effect.logInfo("Cloudinary webhook verification succeeded", {
      serviceName: config.serviceName,
      cloudName: config.cloudName,
      timestamp,
    });

    return result;
  }).pipe(
    Effect.scoped,
    Effect.tapError((error) =>
      Effect.logWarning("Cloudinary webhook verification failed", {
        serviceName: config.serviceName,
        cloudName: config.cloudName,
        errorType: error._tag,
        errorMessage: error.message,
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
