import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
  ResendWebhookProcessingError,
  ResendWebhookService,
  resendWebhookRefusal,
} from "@/features/checkout/backend/fulfillment";
import { defineWebhookRoute } from "@/shared/backend/service-route";

const processWebhookRequest = Effect.fn("processResendWebhookRequest")(
  function* (request: Request) {
    const payload = yield* Effect.tryPromise({
      try: () => request.text(),
      catch: (cause) =>
        new ResendWebhookProcessingError({
          errorCode: "resend_webhook_payload_invalid",
          message: "Resend webhook request body could not be read.",
          cause,
        }),
    });

    const webhooks = yield* ResendWebhookService;
    return yield* webhooks.processWebhook({
      payload,
      headers: {
        id: request.headers.get("svix-id"),
        timestamp: request.headers.get("svix-timestamp"),
        signature: request.headers.get("svix-signature"),
      },
    });
  },
  Effect.scoped
);

/**
 * POST /api/webhooks/resend
 *
 * Receives Resend delivery status for workspace customer fulfilment emails.
 */
export const POST = defineWebhookRoute(
  {
    operation: "resendWebhook",
    failureMessage: "Resend webhook processing failed",
  },
  (request) =>
    processWebhookRequest(request).pipe(
      Effect.tap((result) =>
        Effect.logInfo("Resend webhook response ready", { result })
      ),
      Effect.mapError(resendWebhookRefusal),
      Effect.provide(ResendWebhookService.Live)
    )
);

/**
 * GET /api/webhooks/resend
 *
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/resend",
  });
}
