import {
  type WebhookDisposition,
  WebhookRefusal,
} from "@/shared/backend/service-route";
import type { NexiWebhookProcessingError } from "./nexi-webhook.service";

/**
 * A notification that retrying cannot fix, including one whose security token
 * does not match, is declined so Nexi stops retrying it on the payment path.
 */
export const nexiWebhookDisposition = {
  nexi_webhook_parse_failed: {
    kind: "rejected",
    status: 400,
    severity: "error",
  },
  nexi_webhook_unknown_order: { kind: "declined", severity: "error" },
  nexi_webhook_missing_security_token: { kind: "declined", severity: "error" },
  nexi_webhook_invalid_currency: { kind: "declined", severity: "error" },
  nexi_webhook_verification_failed: { kind: "retry", severity: "error" },
  nexi_webhook_verification_mismatch: { kind: "declined", severity: "error" },
  nexi_webhook_late_payment: { kind: "declined", severity: "fatal" },
  nexi_webhook_late_payment_recovery_failed: {
    kind: "retry",
    severity: "error",
  },
  nexi_webhook_refund_reconciliation_failed: {
    kind: "retry",
    severity: "error",
  },
  nexi_webhook_transition_failed: { kind: "retry", severity: "fatal" },
  nexi_webhook_fulfillment_failed: { kind: "retry", severity: "fatal" },
} satisfies Record<NexiWebhookProcessingError["errorCode"], WebhookDisposition>;

export const nexiWebhookRefusal = (error: NexiWebhookProcessingError) =>
  new WebhookRefusal({
    disposition: nexiWebhookDisposition[error.errorCode],
    code: error.errorCode,
    details: { eventId: error.eventId, orderId: error.orderId },
    cause: error.cause,
  });
