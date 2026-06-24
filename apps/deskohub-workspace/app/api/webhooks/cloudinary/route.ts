import {
  CloudinaryWebhookVerifier,
  makeCloudinaryRuntimeConfigLayer,
  type VerifiedCloudinaryWebhook,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect, Layer } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const CloudinaryWebhookVerifierLive = CloudinaryWebhookVerifier.Live.pipe(
  Layer.provide(
    makeCloudinaryRuntimeConfigLayer({
      cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      serviceName: "deskohub-workspace",
    })
  )
);

const processWebhook = Effect.fn("processWebhook")(function* (
  webhook: VerifiedCloudinaryWebhook
) {
  yield* Effect.annotateLogsScoped({ webhook });
  yield* Effect.logInfo("Processing Cloudinary webhook");

  const tagToRevalidate = cloudinaryTags.all();
  yield* Effect.annotateLogsScoped({ tagToRevalidate });
  yield* Effect.logInfo("Cloudinary webhook cache invalidation started");
  revalidateTag(tagToRevalidate, "max");

  yield* Effect.logInfo("Cloudinary webhook cache invalidation completed", {
    invalidatedTag: tagToRevalidate,
    webhookTimestamp: webhook.timestamp,
  });

  const result = NextResponse.json({
    message: "Webhook received",
  });
  yield* Effect.annotateLogsScoped({ result });
  yield* Effect.logInfo("Cloudinary webhook processed");

  return result;
});

const processWebhookRequest = Effect.fn("processCloudinaryWebhookRequest")(
  function* (request: Request) {
    yield* Effect.annotateLogsScoped({
      request: {
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        url: request.url,
      },
    });
    yield* Effect.logInfo("Cloudinary webhook invoked");

    const webhook = yield* verifyCloudinaryWebhookRequest(request);
    yield* Effect.annotateLogsScoped({ webhook });
    yield* Effect.logInfo("Cloudinary webhook verified");

    return yield* processWebhook(webhook);
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({
        method: "POST",
        operation: "cloudinaryWebhook",
      })
    )
);

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export async function POST(request: Request): Promise<NextResponse> {
  return runWorkspaceRequestEffect(
    request,
    processWebhookRequest(request).pipe(
      Effect.provide(CloudinaryWebhookVerifierLive),
      Effect.catchTag(
        "CloudinaryWebhookAuthError",
        Effect.fn("logCloudinaryWebhookAuthError")(function* (error) {
          yield* Effect.logWarning("Cloudinary webhook authentication failed", {
            error,
          });

          return yield* Effect.fail(error);
        })
      ),
      Effect.catchTag(
        "CloudinaryWebhookValidationError",
        Effect.fn("logCloudinaryWebhookValidationError")(function* (error) {
          yield* Effect.logWarning("Cloudinary webhook validation failed", {
            error,
          });

          return yield* Effect.fail(error);
        })
      ),
      Effect.catchTags({
        CloudinaryWebhookAuthError: (error) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Unauthorized",
                message: error.message,
              },
              { status: 401 }
            )
          ),
        CloudinaryWebhookValidationError: (error) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Invalid payload",
                message: error.message,
              },
              {
                status: 400,
              }
            )
          ),
      })
    )
  );
}

/**
 * GET /api/webhooks/cloudinary
 *
 * Health check endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/cloudinary",
  });
}
