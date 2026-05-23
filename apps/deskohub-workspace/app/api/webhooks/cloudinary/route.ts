import {
  type VerifiedCloudinaryWebhook,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

export const runtime = "nodejs";

const processWebhook = Effect.fn("processWebhook")(
  function* (webhook: VerifiedCloudinaryWebhook) {
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
  },
  (effect) =>
    effect.pipe(
      Effect.annotateLogs({
        operation: "processWebhook",
      })
    )
);

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export async function POST(request: Request): Promise<NextResponse> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.log("Webhook invoked");

      const webhook = yield* verifyCloudinaryWebhookRequest(request, {
        cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
        serviceName: "deskohub-workspace",
      });

      return yield* processWebhook(webhook);
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError(error);
        })
      ),
      Effect.annotateLogs({
        method: "POST",
        operation: "webhook",
      }),
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
