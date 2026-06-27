import { Effect } from "effect";
import { NextResponse } from "next/server";
import {
  ResendWebhookProcessingError,
  ResendWebhookService,
  ResendWebhookServiceLiveWithDependencies,
} from "@/features/checkout/backend/resend-webhook.service";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

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
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.annotateLogs({ method: "POST", operation: "resendWebhook" })
    )
);

const handleResendWebhookProcessingError = Effect.fn(
  "handleResendWebhookProcessingError"
)(function* (error: ResendWebhookProcessingError) {
  const status =
    error.errorCode === "resend_webhook_headers_missing" ||
    error.errorCode === "resend_webhook_verification_failed" ||
    error.errorCode === "resend_webhook_payload_invalid"
      ? 400
      : 500;

  yield* Effect.logError("Resend webhook processing failed", {
    errorCode: error.errorCode,
    eventId: error.eventId,
    workspaceReservationId: error.workspaceReservationId,
    cause: error.cause,
  });

  if (status === 500) {
    yield* Effect.logWarning("Resend webhook response will trigger retry", {
      errorCode: error.errorCode,
      eventId: error.eventId,
      workspaceReservationId: error.workspaceReservationId,
    });
  }

  return NextResponse.json(
    {
      error: "Webhook processing failed",
      code: error.errorCode,
    },
    { status }
  );
});

const handleResendWebhookRouteError = Effect.fn(
  "handleResendWebhookRouteError"
)(function* (cause: unknown) {
  yield* Effect.logError("Resend webhook route failed", { cause });
  yield* Effect.logWarning("Resend webhook response will trigger retry", {
    errorCode: "resend_webhook_internal_error",
  });

  return NextResponse.json(
    {
      error: "Webhook processing failed",
      code: "resend_webhook_internal_error",
    },
    { status: 500 }
  );
});

/**
 * POST /api/webhooks/resend
 *
 * Receives Resend delivery status for workspace customer fulfilment emails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return runWorkspaceRequestEffect(
    request,
    processWebhookRequest(request).pipe(
      Effect.provide(ResendWebhookServiceLiveWithDependencies),
      Effect.tap((result) =>
        Effect.logInfo("Resend webhook response ready", { result })
      ),
      Effect.map((result) =>
        NextResponse.json({
          message: "Webhook received",
          status: result.status,
          reason: result.reason,
        })
      ),
      Effect.catchTag(
        "ResendWebhookProcessingError",
        handleResendWebhookProcessingError
      ),
      Effect.catch(handleResendWebhookRouteError)
    )
  );
}

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
