import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { CloudinaryImageCacheTags } from "@/shared/backend/utils/cache-tags";
import { validateWebhookSignature } from "@/shared/backend/utils/webhook";

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
    const tagsToRevalidate = new CloudinaryImageCacheTags().all;
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
        validateWebhookSignature(request, bodyText, env.CLOUDINARY_API_SECRET),
        "WebhookAuthError",
        (error) =>
          Effect.succeed(
            NextResponse.json(
              { error: "Unauthorized", message: error.message },
              { status: 401 }
            )
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
