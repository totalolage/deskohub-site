import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
import { formatMoney, type Money } from "@/shared/money/money";
import { cn } from "@/shared/utils";

type ReservationAdvertisedPriceProps = {
  readonly amount: Money;
  readonly className?: string;
  readonly locale: Locale;
  readonly originalAmount?: Money;
  readonly originalAmountClassName?: string;
  readonly suffix?: ReactNode;
};

export function ReservationAdvertisedPrice({
  amount,
  className,
  locale,
  originalAmount,
  originalAmountClassName,
  suffix,
}: ReservationAdvertisedPriceProps) {
  if (!originalAmount) {
    return (
      <span className={className}>
        {formatMoney(amount, locale)}
        {suffix}
      </span>
    );
  }

  return (
    <>
      <span className="sr-only">
        {m.checkoutSummaryOriginalPrice(
          { price: formatMoney(originalAmount, locale) },
          { locale }
        )}
      </span>
      <del
        aria-hidden="true"
        className={cn(
          "text-navy-blue/45 decoration-navy-blue/40",
          originalAmountClassName
        )}
      >
        {formatMoney(originalAmount, locale)}
      </del>
      <span className="sr-only">
        {m.checkoutSummaryDiscountedPrice(
          { price: formatMoney(amount, locale) },
          { locale }
        )}
      </span>
      <span className={cn("text-aquamarine-ink", className)}>
        <span aria-hidden="true">{formatMoney(amount, locale)}</span>
        {suffix}
      </span>
    </>
  );
}
