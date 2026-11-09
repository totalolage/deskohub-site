import { expect, test } from "bun:test";
import { Effect, Record } from "effect";
import { defineWebhookRoute } from "@/shared/backend/service-route";
import { DeliveryReportError, DeliveryRequestError } from "./delivery-reports";
import {
  resendWebhookRefusal,
  resendWebhookRequestDisposition,
} from "./resend-webhook-disposition";

const pinnedRequestStatuses = {
  resend_webhook_headers_missing: 400,
  resend_webhook_api_key_missing: 500,
  resend_webhook_secret_missing: 500,
  // A Svix signature failure is a 400, not a 401.
  resend_webhook_verification_failed: 400,
  resend_webhook_payload_invalid: 400,
} as const satisfies Record<DeliveryRequestError["errorCode"], 400 | 500>;

// Every code the route's handlers report today.
const handlerErrorCodes = [
  "resend_webhook_delivery_unattached",
  "resend_webhook_reservation_load_failed",
  "resend_webhook_invoice_processing_failed",
  "resend_webhook_reservation_update_failed",
  "resend_webhook_campaign_update_failed",
];

let failure: DeliveryRequestError | DeliveryReportError;
const POST = defineWebhookRoute(
  { operation: "test.resendWebhookDisposition", failureMessage: "Unused" },
  () => Effect.fail(resendWebhookRefusal(failure))
);

const expectRefusal = async (errorCode: string, status: number) => {
  const response = await POST(new Request("https://workspace.test"));

  expect(response.status).toBe(status);
  expect(await response.text()).toBe(
    JSON.stringify({ error: "Webhook processing failed", code: errorCode })
  );
};

test.each(Record.toEntries(pinnedRequestStatuses))(
  "answers the request failure %s with its pinned status and logs it as an error",
  async (errorCode, status) => {
    failure = new DeliveryRequestError({
      errorCode,
      message: "Resend webhook test failure",
    });

    await expectRefusal(errorCode, status);
    expect(resendWebhookRequestDisposition[errorCode].severity).toBe("error");
  }
);

test.each(handlerErrorCodes)(
  "answers the unapplied report %s with a retryable 500",
  async (errorCode) => {
    failure = new DeliveryReportError({
      errorCode,
      message: "Resend webhook test failure",
    });

    await expectRefusal(errorCode, 500);
    expect(resendWebhookRefusal(failure).disposition).toEqual({
      kind: "retry",
      severity: "error",
    });
  }
);

test("logs the event ID with the handler's delivery identifiers", () => {
  const refusal = resendWebhookRefusal(
    new DeliveryReportError({
      errorCode: "resend_webhook_delivery_unattached",
      message: "Resend webhook test failure",
      eventId: "evt-1" as never,
      details: { workspaceReservationId: "reservation-1" },
    })
  );

  expect(refusal.details).toEqual({
    eventId: "evt-1",
    workspaceReservationId: "reservation-1",
  });
});
