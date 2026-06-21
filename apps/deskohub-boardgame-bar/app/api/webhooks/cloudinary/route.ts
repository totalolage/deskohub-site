import {
  CloudinaryWebhookVerifier,
  makeCloudinaryRuntimeConfigLayer,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect, Layer } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export async function POST(request: Request): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.annotateLogsScoped({
        request: {
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
          url: request.url,
        },
      });
      yield* Effect.logInfo("Cloudinary webhook request invoked");

      yield* Effect.logInfo("Cloudinary webhook verification started");
      const webhook = yield* verifyCloudinaryWebhookRequest(request);
      yield* Effect.annotateLogsScoped({ webhook });
      yield* Effect.logInfo("Cloudinary webhook verification succeeded");

      yield* Effect.logInfo("Processing Cloudinary webhook");

      // Invalidate all cloudinary image caches
      // In the future when we parse the data from the webhook,
      // we can invalidate only the affected images
      const tagToRevalidate = cloudinaryTags.all();
      yield* Effect.logInfo("Cloudinary cache invalidation started", {
        invalidatedTag: tagToRevalidate,
      });
      revalidateTag(tagToRevalidate, "max");

      yield* Effect.logInfo("Cloudinary cache invalidation completed", {
        invalidatedTag: tagToRevalidate,
        webhookTimestamp: webhook.timestamp,
      });

      const response = NextResponse.json({
        message: "Webhook received",
      });
      yield* Effect.logInfo("Cloudinary webhook response ready", { response });
      return response;
    }).pipe(
      Effect.catchTags({
        CloudinaryWebhookAuthError: (error) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Unauthorized", message: error.message },
              { status: 401 }
            )
          ),
        CloudinaryWebhookValidationError: (error) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Invalid payload", message: error.message },
              { status: 400 }
            )
          ),
      }),
      Effect.scoped,
      Effect.provide(
        CloudinaryWebhookVerifier.Live.pipe(
          Layer.provide(
            makeCloudinaryRuntimeConfigLayer({
              cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
              apiKey: env.CLOUDINARY_API_KEY,
              apiSecret: env.CLOUDINARY_API_SECRET,
              serviceName: "deskohub-boardgame-bar",
            })
          )
        )
      ),
      Effect.tapError(Effect.logError),
      Effect.annotateLogs({
        method: "POST",
        operation: "webhook",
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
