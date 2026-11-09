import type { Locale } from "@/features/i18n";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import type { AdministrationPaymentAttempt } from "./administration.service";
import {
  formatAdministrationDateTime,
  getAdministrationPaymentStatus,
} from "./formatters";
import { m } from "./i18n";

type DisplayedPayment = Pick<
  AdministrationPaymentAttempt,
  | "amount"
  | "failureCode"
  | "refundState"
  | "refundedAmount"
  | "refundedAt"
  | "state"
  | "updatedAt"
>;

/**
 * The paid amount, struck through once Nexi reports a refund. A partial refund
 * also shows the amount Deskohub keeps. The refund is spelled out for screen
 * readers, which do not announce the strikethrough.
 */
export function PaymentAmount({
  locale,
  payment,
}: {
  readonly locale: Locale;
  readonly payment: DisplayedPayment;
}) {
  const status = getAdministrationPaymentStatus(payment, locale);
  const amount = formatMoney(payment.amount, locale);
  if (!status.refunded) return amount;
  return (
    <>
      <del className="font-normal text-navy-blue/55 line-through">
        {amount}
        <span className="sr-only">
          {" "}
          {status.retainedAmount
            ? m.administrationPaymentAmountBeforeRefund({}, { locale })
            : m.administrationPaymentAmountRefunded({}, { locale })}
        </span>
      </del>
      {status.retainedAmount && (
        <>
          {" "}
          {formatMoney(status.retainedAmount, locale)}
          <span className="sr-only">
            {" "}
            {m.administrationPaymentAmountAfterRefund({}, { locale })}
          </span>
        </>
      )}
    </>
  );
}

/** The payment status and when it was reached, such as "Paid · Oct 12, 2026, 08:34". */
export function PaymentStatusText({
  locale,
  payment,
}: {
  readonly locale: Locale;
  readonly payment: DisplayedPayment;
}) {
  const status = getAdministrationPaymentStatus(payment, locale);
  return m.administrationPaymentStatusAt(
    {
      status: status.label,
      time: formatAdministrationDateTime(status.at, locale),
    },
    { locale }
  );
}

/** The payment status, with the refund time once refunded, such as "Paid". */
export function PaymentStatusLabel({
  locale,
  payment,
}: {
  readonly locale: Locale;
  readonly payment: DisplayedPayment;
}) {
  const status = getAdministrationPaymentStatus(payment, locale);
  return status.refunded
    ? m.administrationPaymentStatusAt(
        {
          status: status.label,
          time: formatAdministrationDateTime(status.at, locale),
        },
        { locale }
      )
    : status.label;
}

export function PaymentRefundRequiredLabel({
  className,
  locale,
  payment,
}: {
  readonly className?: string;
  readonly locale: Locale;
  readonly payment: DisplayedPayment;
}) {
  if (!getAdministrationPaymentStatus(payment, locale).needsRefund) return null;
  return (
    <span
      className={cn("block font-semibold text-burned-orange-ink", className)}
    >
      {m.administrationPaymentNeedsRefund({}, { locale })}
    </span>
  );
}
