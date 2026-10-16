import type { PaymentAttemptState } from "@/db/schema";
import type { Locale } from "@/features/i18n";
import type { AdministrationPaymentAttempt } from "./administration.service";
import { m } from "./i18n";

export const getProviderValueLabel = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

const operationFailureResults = new Set([
  "CANCELED",
  "CANCELLED",
  "DECLINED",
  "DENIED",
  "DENIED_BY_RISK",
  "FAILED",
  "REFUNDED",
  "THREEDS_FAILED",
  "VOIDED",
]);

const operationWarningTypes = new Set(["CANCEL", "REFUND", "VOID"]);

export const getProviderOperationTimelineTone = (
  operationType: string | undefined,
  operationResult: string | undefined
): "neutral" | "positive" | "warning" => {
  const type = operationType?.toUpperCase();
  const result = operationResult?.toUpperCase();
  if (
    (result && operationFailureResults.has(result)) ||
    (type && operationWarningTypes.has(type))
  ) {
    return "warning";
  }
  if (
    (type === "AUTHORIZATION" && result === "AUTHORIZED") ||
    ((type === "AUTHORIZATION" || type === "CAPTURE") && result === "EXECUTED")
  ) {
    return "positive";
  }
  return "neutral";
};

/** Whether the hold cleanup gave up on the payment after the local payment window. */
export const isAbandonedPayment = (
  payment: Pick<AdministrationPaymentAttempt, "failureCode">
) => payment.failureCode === "payment_abandoned_after_provider_cutoff";

/**
 * The payment's progress as operators read it in summaries: every way an
 * attempt can end without money is "Unsuccessful", except the hold cleanup
 * releasing it after the local payment window, which is "Abandoned".
 */
export const getAdministrationPaymentStateLabel = (
  payment: Pick<AdministrationPaymentAttempt, "failureCode" | "state">,
  locale: Locale
) => {
  if (isAbandonedPayment(payment)) {
    return m.administrationPaymentStateAbandoned({}, { locale });
  }
  switch (payment.state) {
    case "created":
      return m.administrationPaymentStateStarted({}, { locale });
    case "pending":
      return m.administrationPaymentStatePending({}, { locale });
    case "paid":
      return m.administrationPaymentStatePaid({}, { locale });
    case "failed":
    case "cancelled":
    case "expired":
      return m.administrationPaymentStateUnsuccessful({}, { locale });
  }
};

/** The exact local attempt state, as the order reconciliation shows it. */
export const getAdministrationPaymentAttemptStateLabel = (
  state: PaymentAttemptState,
  locale: Locale
) => {
  switch (state) {
    case "created":
      return m.administrationPaymentAttemptStateCreated({}, { locale });
    case "pending":
      return m.administrationPaymentAttemptStatePending({}, { locale });
    case "paid":
      return m.administrationPaymentAttemptStatePaid({}, { locale });
    case "failed":
      return m.administrationPaymentAttemptStateFailed({}, { locale });
    case "cancelled":
      return m.administrationPaymentAttemptStateCancelled({}, { locale });
    case "expired":
      return m.administrationPaymentAttemptStateExpired({}, { locale });
  }
};

/** How the payment is collected: online through Nexi, or included at no charge. */
export const getAdministrationPaymentProviderLabel = (
  provider: AdministrationPaymentAttempt["provider"],
  locale: Locale
) =>
  provider === "internal"
    ? m.administrationPaymentProviderIncluded({}, { locale })
    : m.administrationPaymentProviderOnline({}, { locale });
