import {
  type WebhookDisposition,
  WebhookRefusal,
} from "@/shared/backend/service-route";
import type { ResendWebhookProcessingError } from "./resend-webhook.service";

const rejected = { kind: "rejected", status: 400, severity: "error" } as const;
const retry = { kind: "retry", severity: "error" } as const;

/**
 * A delivery without valid Svix headers, signature, or body is rejected; a
 * missing configuration or a failed update answers 500 so Resend retries it.
 */
export const resendWebhookDisposition = {
  resend_webhook_headers_missing: rejected,
  resend_webhook_api_key_missing: retry,
  resend_webhook_secret_missing: retry,
  resend_webhook_verification_failed: rejected,
  resend_webhook_payload_invalid: rejected,
  resend_webhook_delivery_unattached: retry,
  resend_webhook_reservation_load_failed: retry,
  resend_webhook_invoice_processing_failed: retry,
  resend_webhook_reservation_update_failed: retry,
  resend_webhook_campaign_update_failed: retry,
} satisfies Record<
  ResendWebhookProcessingError["errorCode"],
  WebhookDisposition
>;

export const resendWebhookRefusal = (error: ResendWebhookProcessingError) =>
  new WebhookRefusal({
    disposition: resendWebhookDisposition[error.errorCode],
    code: error.errorCode,
    details: {
      eventId: error.eventId,
      workspaceReservationId: error.workspaceReservationId,
    },
    cause: error.cause,
  });
