"use client";

import { Clock3 } from "lucide-react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import { formatDiscountCountdown } from "@/features/checkout/format-discount-countdown";
import { type Locale, m } from "@/features/i18n";
import { useDiscountCountdown } from "./use-discount-countdown";

export function CheckoutSummaryDiscountCountdown({
  discount,
  locale,
}: {
  readonly discount: CheckoutSummaryDiscount["discount"];
  readonly locale: Locale;
}) {
  const countdown = useDiscountCountdown(discount);

  if (!countdown) {
    return null;
  }

  const remaining = formatDiscountCountdown(countdown, locale);

  return (
    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-burned-orange">
      <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
      {m.checkoutSummaryDiscountEnds({ remaining }, { locale })}
    </span>
  );
}
