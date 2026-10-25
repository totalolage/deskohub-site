import { expect, test } from "bun:test";
import { Record } from "effect";
import { webhookResponseStatus } from "@/shared/backend/service-route";
import { resendWebhookDisposition } from "./resend-webhook-disposition";

test("answers each Resend failure with its pinned status and log severity", () => {
  expect(
    Record.map(resendWebhookDisposition, (disposition) => [
      webhookResponseStatus(disposition),
      disposition.severity,
    ])
  ).toEqual({
    resend_webhook_headers_missing: [400, "error"],
    resend_webhook_api_key_missing: [500, "error"],
    resend_webhook_secret_missing: [500, "error"],
    // A Svix signature failure is a 400, not a 401.
    resend_webhook_verification_failed: [400, "error"],
    resend_webhook_payload_invalid: [400, "error"],
    resend_webhook_delivery_unattached: [500, "error"],
    resend_webhook_reservation_load_failed: [500, "error"],
    resend_webhook_invoice_processing_failed: [500, "error"],
    resend_webhook_reservation_update_failed: [500, "error"],
    resend_webhook_campaign_update_failed: [500, "error"],
  });
});
