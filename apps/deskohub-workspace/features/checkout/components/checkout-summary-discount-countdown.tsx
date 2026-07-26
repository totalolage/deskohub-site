"use client";

import { AlertTriangle, Clock3 } from "lucide-react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-summary";
import { formatDiscountCountdown } from "@/features/checkout/format-discount-countdown";
import { type Locale, m } from "@/features/i18n";
import { useDiscountCountdownState } from "./use-discount-countdown-state";

export function CheckoutSummaryDiscountCountdown({
  discount,
  locale,
}: {
  readonly discount: CheckoutSummaryDiscount["discount"];
  readonly locale: Locale;
}) {
  const countdownState = useDiscountCountdownState(discount);

  if (countdownState?.status === "expired") {
    return (
      <span className="mt-1 flex items-center gap-1 text-xs font-medium text-burned-orange">
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
        {m.checkoutSummaryDiscountExpired({}, { locale })}
      </span>
    );
  }

  if (countdownState?.status !== "active") {
    return null;
  }

  const remaining = formatDiscountCountdown(countdownState.countdown, locale);

  return (
    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-burned-orange">
      <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
      {m.checkoutSummaryDiscountEnds({ remaining }, { locale })}
    </span>
  );
}
