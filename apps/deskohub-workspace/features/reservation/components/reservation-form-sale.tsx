"use client";

import { Percent } from "lucide-react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import type { Locale } from "@/features/i18n";

export function ReservationFormSale({
  discounts,
  locale,
  productLabel,
}: {
  readonly discounts: readonly CheckoutSummaryDiscount[];
  readonly locale: Locale;
  readonly productLabel: string;
}) {
  return (
    <div
      className="relative z-20 flex items-center gap-2 border-b border-purple-300/60 bg-purple-100 px-6 py-3 text-sm font-semibold leading-5 text-purple-900"
      data-reservation-sale-banner
    >
      <Percent aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5">
        {discounts.map(({ discount }) => (
          <span key={discount.id} data-reservation-sale-discount={discount.id}>
            {discount.label}
          </span>
        ))}
      </span>
      <CheckoutSummaryDiscountDetails
        discounts={discounts}
        locale={locale}
        productLabel={productLabel}
      />
    </div>
  );
}
