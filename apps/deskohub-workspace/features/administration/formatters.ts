import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import type { Locale } from "@/features/i18n";
import { temporalInstantToDate, workspaceSiteConstants } from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import type {
  AdministrationMoney,
  AdministrationPaymentAttempt,
  AdministrationReservationSummary,
} from "./administration.service";
import { m } from "./i18n";
import { getAdministrationPaymentStateLabel } from "./payment-presentation";

// Operators work on Prague time, so every locale shows the 24-hour clock. A
// day period could also differ between server and browser: depending on its
// ICU version, Node separates "PM" with a narrow no-break space that Chromium
// writes as a plain space, which fails hydration in the client tables.
export const formatAdministrationDateTime = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).format(temporalInstantToDate(Temporal.Instant.from(value)));

export const formatAdministrationPlainDate = (value: string, locale: Locale) =>
  formatPlainDate({ date: Temporal.PlainDate.from(value), locale });

export const formatAdministrationReservationDate = (
  reservation: Pick<
    AdministrationReservationSummary,
    "date" | "startsAt" | "type"
  >,
  locale: Locale
) => {
  if (reservation.type === "cowork" && reservation.date) {
    return formatAdministrationPlainDate(reservation.date, locale);
  }
  if (reservation.startsAt) {
    return formatAdministrationDateTime(reservation.startsAt, locale);
  }
  return reservation.date
    ? formatAdministrationPlainDate(reservation.date, locale)
    : null;
};

export const formatAdministrationMoney = (
  { currency, exponent, value }: AdministrationMoney,
  locale: Locale
) =>
  formatCurrencyAmount({
    amount: value / 10 ** exponent,
    currency,
    locale,
    fractionDigits: exponent,
  });

export type AdministrationPaymentStatus = {
  /** "Paid", "Refunded", or "Partially refunded" with the refunded amount, in the locale. */
  readonly label: string;
  /** When the payment reached this status: the refund time once refunded. */
  readonly at: string;
  readonly refunded: boolean;
  /** The amount Deskohub keeps after a partial refund. */
  readonly retainedAmount: AdministrationMoney | null;
  /** The payment still has to be refunded in the Nexi back office. */
  readonly needsRefund: boolean;
};

/**
 * The payment status operators see. A recorded Nexi refund, full or partial,
 * replaces the attempt state, because the money is no longer held.
 */
export const getAdministrationPaymentStatus = (
  attempt: Pick<
    AdministrationPaymentAttempt,
    | "amount"
    | "failureCode"
    | "refundState"
    | "refundedAmount"
    | "refundedAt"
    | "state"
    | "updatedAt"
  >,
  locale: Locale
): AdministrationPaymentStatus => {
  const { refundedAmount, refundedAt } = attempt;
  if (attempt.refundState !== "refunded" || !refundedAmount || !refundedAt) {
    return {
      label: getAdministrationPaymentStateLabel(attempt, locale),
      at: attempt.updatedAt,
      refunded: false,
      retainedAmount: null,
      needsRefund: attempt.refundState === "required",
    };
  }
  const partial = refundedAmount.value < attempt.amount.value;
  return {
    label: partial
      ? m.administrationPaymentStatusPartiallyRefunded(
          { amount: formatAdministrationMoney(refundedAmount, locale) },
          { locale }
        )
      : m.administrationPaymentStatusRefunded({}, { locale }),
    at: refundedAt,
    refunded: true,
    retainedAmount: partial
      ? {
          ...attempt.amount,
          value: attempt.amount.value - refundedAmount.value,
        }
      : null,
    needsRefund: false,
  };
};
