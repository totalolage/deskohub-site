import { Match } from "effect";
import {
  type WebhookDisposition,
  WebhookRefusal,
} from "@/shared/backend/service-route";
import type {
  DeliveryReportError,
  DeliveryRequestError,
} from "./delivery-reports";

const rejected = { kind: "rejected", status: 400, severity: "error" } as const;
const retry = { kind: "retry", severity: "error" } as const;

/**
 * A request without valid Svix headers, signature, or body is rejected; a
 * missing configuration answers 500 so Resend retries it.
 */
export const resendWebhookRequestDisposition = {
  resend_webhook_headers_missing: rejected,
  resend_webhook_api_key_missing: retry,
  resend_webhook_secret_missing: retry,
  resend_webhook_verification_failed: rejected,
  resend_webhook_payload_invalid: rejected,
} satisfies Record<DeliveryRequestError["errorCode"], WebhookDisposition>;

const refusalOf = Match.type<DeliveryRequestError | DeliveryReportError>().pipe(
  Match.tagsExhaustive({
    DeliveryRequestError: (error) => ({
      disposition: resendWebhookRequestDisposition[error.errorCode],
      details: { eventId: error.eventId },
    }),
    // A report its handler could not apply yet answers 500 so Resend
    // retries it.
    DeliveryReportError: (error) => ({
      disposition: retry,
      details: { eventId: error.eventId, ...error.details },
    }),
  })
);

export const resendWebhookRefusal = (
  error: DeliveryRequestError | DeliveryReportError
) =>
  new WebhookRefusal({
    ...refusalOf(error),
    code: error.errorCode,
    cause: error.cause,
  });
