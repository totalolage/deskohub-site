import { createHmac } from "node:crypto";
import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { cloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";

/**
 * Webhook Errors
 */
class CloudinaryWebhookAuthError extends Data.TaggedError(
  "CloudinaryWebhookAuthError"
)<{
  readonly message: string;
}> {}

/**
 * Generate new Cloudinary webhook signature
 * Based on: https://cloudinary.com/documentation/notification_signatures
 */
const getSignature = (body: string, timestamp: string) =>
  createHmac("sha256", env.CLOUDINARY_API_SECRET)
    .update(`${body}${timestamp}`)
    .digest("hex");

/**
 * Validate webhook signature
 */
const validateWebhookSignature = (
  request: Request,
  bodyText: string
): Effect.Effect<void, CloudinaryWebhookAuthError> =>
  Effect.gen(function* () {
    // Get signature headers
    const signature = request.headers.get("x-cld-signature");
    const timestamp = request.headers.get("x-cld-timestamp");

    if (!signature || !timestamp) {
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({
          message: "Missing signature or timestamp headers",
        })
      );
    }

    if (getSignature(bodyText, timestamp) !== signature) {
      return yield* Effect.fail(
        new CloudinaryWebhookAuthError({
          message: "Invalid signature",
        })
      );
    }
  });

class JsonParseError extends Data.TaggedError("JsonParseError")<{
  message: string;
}> {}

const processWebhook = (bodyText: string) =>
  Effect.gen(function* () {
    yield* Effect.log("Cloudinary webhook signature validated");

    const body = yield* Effect.try({
      try: () => JSON.parse(bodyText),
      catch: (error) =>
        new JsonParseError({
          message:
            error instanceof Error ? error.message : "Unknown parse error",
        }),
    });

    // Invalidate all cloudinary image caches
    // In the future when we parse the data from the webhook,
    // we can invalidate only the affected images
    const tagsToRevalidate = cloudinaryImageCacheTags().all;
    revalidateTag(tagsToRevalidate);

    yield* Effect.log("Cloudinary webhook received, cache invalidated", {
      invalidatedTag: tagsToRevalidate,
      webhookData: body,
    });

    return NextResponse.json({
      message: "Webhook received",
    });
  });

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export async function POST(request: Request) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const bodyText = yield* Effect.promise(() => request.text());

      yield* Effect.tapErrorTag(
        validateWebhookSignature(request, bodyText),
        "CloudinaryWebhookAuthError",
        (error) =>
          Effect.succeed(
            NextResponse.json({
              status: 401,
              body: { error: "Unauthorized", message: error.message },
            })
          )
      );

      return yield* processWebhook(bodyText);
    })
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
