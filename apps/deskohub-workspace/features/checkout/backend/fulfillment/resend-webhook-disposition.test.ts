import { expect, test } from "bun:test";
import { Effect, Record } from "effect";
import { defineWebhookRoute } from "@/shared/backend/service-route";
import { ResendWebhookProcessingError } from "./resend-webhook.service";
import {
  resendWebhookDisposition,
  resendWebhookRefusal,
} from "./resend-webhook-disposition";

const pinned = {
  resend_webhook_headers_missing: 400,
  resend_webhook_api_key_missing: 500,
  resend_webhook_secret_missing: 500,
  // A Svix signature failure is a 400, not a 401.
  resend_webhook_verification_failed: 400,
  resend_webhook_payload_invalid: 400,
  resend_webhook_delivery_unattached: 500,
  resend_webhook_reservation_load_failed: 500,
  resend_webhook_invoice_processing_failed: 500,
  resend_webhook_reservation_update_failed: 500,
  resend_webhook_campaign_update_failed: 500,
} as const satisfies Record<
  ResendWebhookProcessingError["errorCode"],
  400 | 500
>;

let failure: ResendWebhookProcessingError;
const POST = defineWebhookRoute(
  { operation: "test.resendWebhookDisposition", failureMessage: "Unused" },
  () => Effect.fail(resendWebhookRefusal(failure))
);

test.each(Record.toEntries(pinned))(
  "answers %s with its pinned status and logs it as an error",
  async (errorCode, status) => {
    failure = new ResendWebhookProcessingError({
      errorCode,
      message: "Resend webhook test failure",
    });

    const response = await POST(new Request("https://workspace.test"));

    expect(response.status).toBe(status);
    expect(await response.text()).toBe(
      JSON.stringify({ error: "Webhook processing failed", code: errorCode })
    );
    expect(resendWebhookDisposition[errorCode].severity).toBe("error");
  }
);
