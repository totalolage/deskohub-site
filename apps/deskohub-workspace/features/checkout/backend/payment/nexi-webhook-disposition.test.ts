import { expect, test } from "bun:test";
import { Record } from "effect";
import { webhookResponseStatus } from "@/shared/backend/service-route";
import { nexiWebhookDisposition } from "./nexi-webhook-disposition";

test("answers each Nexi failure with its pinned status and log severity", () => {
  expect(
    Record.map(nexiWebhookDisposition, (disposition) => [
      webhookResponseStatus(disposition),
      disposition.severity,
    ])
  ).toEqual({
    nexi_webhook_parse_failed: [400, "error"],
    nexi_webhook_unknown_order: [202, "error"],
    nexi_webhook_missing_security_token: [202, "error"],
    nexi_webhook_invalid_currency: [202, "error"],
    nexi_webhook_verification_failed: [500, "error"],
    // A token mismatch is declined so Nexi stops retrying it.
    nexi_webhook_verification_mismatch: [202, "error"],
    nexi_webhook_late_payment: [202, "fatal"],
    nexi_webhook_late_payment_recovery_failed: [500, "error"],
    nexi_webhook_refund_reconciliation_failed: [500, "error"],
    nexi_webhook_transition_failed: [500, "fatal"],
    nexi_webhook_fulfillment_failed: [500, "fatal"],
  });
});
