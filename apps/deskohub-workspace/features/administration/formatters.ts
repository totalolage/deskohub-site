import type { Locale } from "@/features/i18n";
import { formatMoney, type Money } from "@/shared/money/money";
import {
  temporalInstantToDate,
  temporalInstantToLocalDateTimeString,
  workspaceSiteConstants,
} from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import type {
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

const formatAdministrationTime = (value: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    timeStyle: "short",
    hourCycle: "h23",
    timeZone: workspaceSiteConstants.location.timeZone,
  }).format(temporalInstantToDate(Temporal.Instant.from(value)));

const toWorkspaceDate = (value: string) =>
  Temporal.Instant.from(value)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate();

/**
 * A Prague date-time for a file export, such as `2026-10-20 14:30`, which
 * spreadsheets read as a date in every locale.
 */
export const formatAdministrationExportDateTime = (value: string) =>
  temporalInstantToLocalDateTimeString({
    instant: Temporal.Instant.from(value),
    timeZone: workspaceSiteConstants.location.timeZone,
  }).replace("T", " ");

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

/**
 * When a meeting room booked with early setup is held from, beside its booked
 * start: the time, with the date when setup starts the day before. Null
 * without early setup.
 */
export const formatAdministrationEarlySetup = (
  reservation: Pick<
    AdministrationReservationSummary,
    "setupStartsAt" | "startsAt"
  >,
  locale: Locale
) => {
  const { setupStartsAt, startsAt } = reservation;
  if (!setupStartsAt) return null;
  const sameDate =
    startsAt !== null &&
    toWorkspaceDate(setupStartsAt).equals(toWorkspaceDate(startsAt));
  return m.administrationReservationEarlySetup(
    {
      time: sameDate
        ? formatAdministrationTime(setupStartsAt, locale)
        : formatAdministrationDateTime(setupStartsAt, locale),
    },
    { locale }
  );
};

export type AdministrationPaymentStatus = {
  /** "Paid", "Refunded", or "Partially refunded" with the refunded amount, in the locale. */
  readonly label: string;
  /** When the payment reached this status: the refund time once refunded. */
  readonly at: string;
  readonly refunded: boolean;
  /** The amount Deskohub keeps after a partial refund. */
  readonly retainedAmount: Money | null;
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
          { amount: formatMoney(refundedAmount, locale) },
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
