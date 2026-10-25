import {
  CloudinaryWebhookVerifier,
  makeCloudinaryRuntimeConfigLayer,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect, Layer } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { cloudinaryWebhookRefusal } from "@/features/gallery/backend/cloudinary-webhook-disposition";
import { defineWebhookRoute } from "@/shared/backend/service-route";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const WorkspaceCloudinaryWebhookVerifierLayer =
  CloudinaryWebhookVerifier.Default.pipe(
    Layer.provide(
      makeCloudinaryRuntimeConfigLayer({
        cloudName: env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
        serviceName: "deskohub-workspace",
      })
    )
  );

const processWebhook = Effect.fn("processWebhook")(function* () {
  yield* Effect.logInfo("Processing Cloudinary webhook");

  const tagToRevalidate = cloudinaryTags.all();
  yield* Effect.logInfo("Cloudinary webhook cache invalidation started");
  revalidateTag(tagToRevalidate, "max");

  yield* Effect.logInfo("Cloudinary webhook cache invalidation completed");
  yield* Effect.logInfo("Cloudinary webhook processed");

  return {};
});

const processWebhookRequest = Effect.fn("processCloudinaryWebhookRequest")(
  function* (request: Request) {
    yield* Effect.logInfo("Cloudinary webhook invoked");

    yield* verifyCloudinaryWebhookRequest(request);
    yield* Effect.logInfo("Cloudinary webhook verified");

    return yield* processWebhook();
  },
  Effect.scoped
);

/**
 * POST /api/webhooks/cloudinary
 *
 * Receives webhooks from Cloudinary
 */
export const POST = defineWebhookRoute(
  {
    operation: "cloudinaryWebhook",
    failureMessage: "Cloudinary webhook processing failed",
  },
  (request) =>
    processWebhookRequest(request).pipe(
      Effect.mapError(cloudinaryWebhookRefusal),
      Effect.provide(WorkspaceCloudinaryWebhookVerifierLayer)
    )
);

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
