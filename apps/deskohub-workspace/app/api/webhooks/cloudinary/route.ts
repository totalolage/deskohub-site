import {
  CloudinaryWebhookVerifier,
  makeCloudinaryRuntimeConfigLayer,
  verifyCloudinaryWebhookRequest,
} from "@deskohub/cloudinary/server";
import { Effect, Layer } from "effect";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { env } from "@/env";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
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

  const response = NextResponse.json({
    message: "Webhook received",
  });
  yield* Effect.logInfo("Cloudinary webhook processed");

  return response;
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
export const POST = defineWorkspaceRoute(
  {
    operation: "cloudinaryWebhook",
    cancellation: "continue-after-disconnect",
  },
  (request) =>
    processWebhookRequest(request).pipe(
      Effect.catchTags({
        CloudinaryWebhookAuthError: (error) =>
          Effect.logWarning("Cloudinary webhook authentication failed").pipe(
            Effect.andThen(Effect.fail(error))
          ),
        CloudinaryWebhookValidationError: (error) =>
          Effect.logWarning("Cloudinary webhook validation failed").pipe(
            Effect.andThen(Effect.fail(error))
          ),
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
      }),
      Effect.provide(WorkspaceCloudinaryWebhookVerifierLayer),
      Effect.mapError(
        WorkspaceRouteFailure.internal("Cloudinary webhook processing failed")
      )
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
