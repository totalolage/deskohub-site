import type { ReactNode } from "react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { cn } from "@/shared/utils";
import { CheckoutSummaryDiscountDetails } from "./checkout-summary-discount-details";

type CheckoutSummaryPriceItem = {
  readonly amount: WorkspaceMoney;
  readonly originalAmount?: WorkspaceMoney;
  readonly discounts?: readonly CheckoutSummaryDiscount[];
};

export function CheckoutSummaryProductLine({
  changed,
  item,
  label,
  locale,
}: {
  readonly changed?: boolean;
  readonly item: CheckoutSummaryPriceItem;
  readonly label: string;
  readonly locale: Locale;
}) {
  const discounted =
    item.originalAmount && item.discounts?.length
      ? {
          discounts: item.discounts,
          originalAmount: item.originalAmount,
        }
      : undefined;

  return (
    <CheckoutSummaryLine changed={changed} label={label} locale={locale}>
      {discounted ? (
        <>
          <span className="sr-only">
            {m.checkoutSummaryOriginalPrice(
              {
                price: formatWorkspaceMoney(discounted.originalAmount, locale),
              },
              { locale }
            )}
          </span>
          <del
            aria-hidden="true"
            className="text-navy-blue/45 decoration-navy-blue/40"
          >
            {formatWorkspaceMoney(discounted.originalAmount, locale)}
          </del>
          <span className="sr-only">
            {m.checkoutSummaryDiscountedPrice(
              { price: formatWorkspaceMoney(item.amount, locale) },
              { locale }
            )}
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 font-semibold tabular-nums"
          >
            {formatWorkspaceMoney(item.amount, locale)}
          </span>
          <CheckoutSummaryDiscountDetails
            discounts={discounted.discounts}
            locale={locale}
            productLabel={label}
          />
        </>
      ) : (
        <span className="shrink-0 font-semibold tabular-nums">
          {formatWorkspaceMoney(item.amount, locale)}
        </span>
      )}
    </CheckoutSummaryLine>
  );
}

export function CheckoutSummaryLine({
  amount,
  changed,
  children,
  label,
  locale,
}: {
  readonly amount?: WorkspaceMoney;
  readonly changed?: boolean;
  readonly children?: ReactNode;
  readonly label: ReactNode;
  readonly locale: Locale;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 text-sm leading-6",
        changed && "font-semibold text-burned-orange"
      )}
    >
      <span>{label}</span>
      <span className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {amount ? (
          <span className="shrink-0 font-semibold tabular-nums">
            {formatWorkspaceMoney(amount, locale)}
          </span>
        ) : null}
        {children}
      </span>
    </div>
  );
}
