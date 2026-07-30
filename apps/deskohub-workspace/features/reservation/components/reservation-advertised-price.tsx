import type { ReactNode } from "react";
import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { cn } from "@/shared/utils";

type ReservationAdvertisedPriceProps = {
  readonly amount: WorkspaceMoney;
  readonly className?: string;
  readonly locale: Locale;
  readonly originalAmount?: WorkspaceMoney;
  readonly suffix?: ReactNode;
};

export function ReservationAdvertisedPrice({
  amount,
  className,
  locale,
  originalAmount,
  suffix,
}: ReservationAdvertisedPriceProps) {
  if (!originalAmount) {
    return (
      <span className={className}>
        {formatWorkspaceMoney(amount, locale)}
        {suffix}
      </span>
    );
  }

  return (
    <>
      <span className="sr-only">
        {m.checkoutSummaryOriginalPrice(
          { price: formatWorkspaceMoney(originalAmount, locale) },
          { locale }
        )}
      </span>
      <del
        aria-hidden="true"
        className="text-navy-blue/45 decoration-navy-blue/40"
      >
        {formatWorkspaceMoney(originalAmount, locale)}
      </del>
      <span className="sr-only">
        {m.checkoutSummaryDiscountedPrice(
          { price: formatWorkspaceMoney(amount, locale) },
          { locale }
        )}
      </span>
      <span className={cn("text-aquamarine-ink", className)}>
        <span aria-hidden="true">{formatWorkspaceMoney(amount, locale)}</span>
        {suffix}
      </span>
    </>
  );
}
