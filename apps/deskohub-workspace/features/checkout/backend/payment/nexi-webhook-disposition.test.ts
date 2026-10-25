import { expect, test } from "bun:test";
import { Effect, Record } from "effect";
import { defineWebhookRoute } from "@/shared/backend/service-route";
import { NexiWebhookProcessingError } from "./nexi-webhook.service";
import {
  nexiWebhookDisposition,
  nexiWebhookRefusal,
} from "./nexi-webhook-disposition";

type NexiWebhookFailureCode = NexiWebhookProcessingError["errorCode"];

const pinned = {
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
} as const satisfies Record<
  NexiWebhookFailureCode,
  readonly [number, "error" | "fatal"]
>;

let failure: NexiWebhookProcessingError;
const POST = defineWebhookRoute(
  { operation: "test.nexiWebhookDisposition", failureMessage: "Unused" },
  () => Effect.fail(nexiWebhookRefusal(failure))
);

test.each(Record.toEntries(pinned))(
  "answers %s with its pinned status and severity",
  async (errorCode, [status, severity]) => {
    failure = new NexiWebhookProcessingError({
      errorCode,
      message: "Nexi webhook test failure",
    });

    const response = await POST(new Request("https://workspace.test"));

    expect(response.status).toBe(status);
    expect(await response.text()).toBe(
      JSON.stringify({ error: "Webhook processing failed", code: errorCode })
    );
    expect(nexiWebhookDisposition[errorCode].severity).toBe(severity);
  }
);
