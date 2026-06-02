import {
  type VerifiedCloudinaryWebhook,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const processWebhook = Effect.fn("processWebhook")(function* (
  webhook: VerifiedCloudinaryWebhook
) {
  yield* Effect.logInfo("Processing webhook");

  const tagToRevalidate = cloudinaryTags.all();
  revalidateTag(tagToRevalidate, "max");

  yield* Effect.logInfo("Cloudinary webhook received, cache invalidated", {
    invalidatedTag: tagToRevalidate,
    webhookTimestamp: webhook.timestamp,
  });

  return NextResponse.json({
    message: "Webhook received",
  });
});

const processWebhookRequest = Effect.fn("processCloudinaryWebhookRequest")(
  function* (request: Request) {
    yield* Effect.log("Webhook invoked");

    const webhook = yield* verifyCloudinaryWebhookRequest(request, {
      cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      serviceName: "deskohub-workspace",
    });

    return yield* processWebhook(webhook);
  },
  (effect) =>
    effect.pipe(
      Effect.annotateLogs({
        method: "POST",
        operation: "webhook",
      })
    )
);

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export async function POST(request: Request): Promise<NextResponse> {
  return runWorkspaceEffect(
    processWebhookRequest(request).pipe(
      Effect.tapError(Effect.logError),
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
