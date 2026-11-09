import { Effect, Layer } from "effect";
import { NextResponse } from "next/server";
import { PostHogEmailDeliveryPolling } from "@/shared/backend/email/posthog-email-delivery-polling";
import {
  defineWebhookRoute,
  WebhookRefusal,
} from "@/shared/backend/service-route";
import { PostHogEmailWebhookConfig } from "@/shared/backend/webhooks/posthog-email-webhook.config";
import {
  type StandardWebhookRejection,
  verifyStandardWebhookRequest,
} from "@/shared/backend/webhooks/standard-webhook-signature";

/** An unsigned or forged request answers 401 and polls nothing. */
const rejectionCode = {
  "headers-missing": "posthog_webhook_headers_missing",
  "verification-failed": "posthog_webhook_verification_failed",
} satisfies Record<StandardWebhookRejection["reason"], string>;

/** An unusable configuration answers 500 so PostHog delivers the signal again. */
const signingSecretRefusal = (code: string, cause?: unknown) =>
  new WebhookRefusal({
    disposition: { kind: "retry", severity: "error" },
    code,
    cause,
  });

/**
 * Verifies PostHog's signal that the status of some PostHog email changed.
 * The signal names no message, so a verified request polls every pending
 * delivery; its payload is ignored.
 */
const receiveDeliveryStatusSignal = Effect.fn(
  "postHogEmailWebhook.receiveDeliveryStatusSignal"
)(function* (request: Request) {
  const { signingSecret } = yield* PostHogEmailWebhookConfig;
  if (!signingSecret) {
    return yield* signingSecretRefusal("posthog_webhook_secret_missing");
  }

  const webhook = yield* verifyStandardWebhookRequest(
    request,
    signingSecret
  ).pipe(
    Effect.catchTags({
      StandardWebhookSecretInvalid: ({ cause }) =>
        Effect.fail(
          signingSecretRefusal("posthog_webhook_secret_invalid", cause)
        ),
      StandardWebhookRejection: ({ reason, cause }) =>
        Effect.fail(
          new WebhookRefusal({
            disposition: { kind: "rejected", status: 401, severity: "error" },
            code: rejectionCode[reason],
            cause,
          })
        ),
    })
  );

  const polling = yield* PostHogEmailDeliveryPolling;
  const summary = yield* polling.poll("signal");
  yield* Effect.logInfo("PostHog email webhook poll completed", {
    webhookId: webhook.id,
    summary,
  });

  return {
    status: summary.outcome,
    reason: summary.outcome === "polled" ? summary.stoppedBy : undefined,
  };
});

/**
 * POST /api/webhooks/posthog
 *
 * Receives PostHog's email status signals.
 */
export const POST = defineWebhookRoute(
  {
    operation: "postHogEmailWebhook",
    failureMessage: "PostHog webhook processing failed",
  },
  (request) =>
    receiveDeliveryStatusSignal(request).pipe(
      Effect.provide(
        Layer.mergeAll(
          PostHogEmailWebhookConfig.Default,
          PostHogEmailDeliveryPolling.Live
        )
      )
    )
);

/**
 * GET /api/webhooks/posthog
 *
 * Health check endpoint.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/posthog",
  });
}
