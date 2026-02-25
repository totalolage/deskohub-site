import { v2 as cloudinary } from "cloudinary";
import { Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  WebhookAuthError,
  WebhookValidationError,
} from "@/shared/backend/utils/webhook";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const processWebhook = Effect.fn("processWebhook")(
  function* (bodyText: string) {
    yield* Effect.logInfo("Processing webhook");

    const body = yield* Effect.try({
      try: () => JSON.parse(bodyText),
      catch: (error) =>
        new WebhookValidationError({
          message: "Invalid JSON payload",
          payload: bodyText,
          cause: error,
        }),
    });

    // Invalidate all cloudinary image caches
    // In the future when we parse the data from the webhook,
    // we can invalidate only the affected images
    const tagToRevalidate = cloudinaryTags.all();
    revalidateTag(tagToRevalidate, "max");

    yield* Effect.logInfo("Cloudinary webhook received, cache invalidated", {
      invalidatedTag: tagToRevalidate,
      webhookData: body,
    });

    return NextResponse.json({
      message: "Webhook received",
    });
  },
  (effect, input) =>
    effect.pipe(
      Effect.annotateLogs({
        operation: "processWebhook",
        input,
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

      // Configure Cloudinary with credentials
      yield* Effect.sync(() => {
        cloudinary.config({
          cloud_name: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
          api_key: env.CLOUDINARY_API_KEY,
          api_secret: env.CLOUDINARY_API_SECRET,
        });
      });

      const bodyText = yield* Effect.promise(() => request.text());

      const signature = request.headers.get("x-cld-signature");
      const timestamp = Number(request.headers.get("x-cld-timestamp"));

      if (!signature || Number.isNaN(timestamp))
        return yield* Effect.fail(
          new WebhookAuthError({
            message: "Missing signature or timestamp",
          })
        );

      if (
        !cloudinary.utils.verifyNotificationSignature(
          bodyText,
          timestamp,
          signature
        )
      )
        return yield* Effect.fail(
          new WebhookAuthError({
            message: "Invalid signature",
          })
        );

      return yield* processWebhook(bodyText);
    }).pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError(error);
        })
      ),
      Effect.annotateLogs({
        method: "POST",
        operation: "webhook",
        request,
      }),
      Effect.catchTags({
        WebhookAuthError: (error) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Unauthorized",
                message: error.message,
              },
              { status: 401 }
            )
          ),
        WebhookValidationError: (error) =>
          Effect.succeed(
            NextResponse.json(
              {
                error: "Invalid payload",
                message: error.message,
                issues: error.issues,
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
