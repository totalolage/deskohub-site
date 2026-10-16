import type { Locale } from "@/features/i18n";
import { cn } from "@/shared/utils";
import type { AdministrationPaymentAttempt } from "./administration.service";
import {
  formatAdministrationDateTime,
  formatAdministrationMoney,
  getAdministrationPaymentStatus,
} from "./formatters";

type DisplayedPayment = Pick<
  AdministrationPaymentAttempt,
  | "amount"
  | "refundState"
  | "refundedAmount"
  | "refundedAt"
  | "stateLabel"
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
  const amount = formatAdministrationMoney(payment.amount, locale);
  if (!status.refunded) return amount;
  return (
    <>
      <del className="font-normal text-navy-blue/55 line-through">
        {amount}
        <span className="sr-only">
          {status.retainedAmount ? " before refund" : " refunded"}
        </span>
      </del>
      {status.retainedAmount && (
        <>
          {" "}
          {formatAdministrationMoney(status.retainedAmount, locale)}
          <span className="sr-only"> after refund</span>
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
  return `${status.label} · ${formatAdministrationDateTime(status.at, locale)}`;
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
    ? `${status.label} · ${formatAdministrationDateTime(status.at, locale)}`
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
      Needs refund
    </span>
  );
}
