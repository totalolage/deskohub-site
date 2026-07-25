"use client";

import { AlertTriangle, Timer } from "lucide-react";
import type {
  CheckoutSummary,
  CheckoutSummaryDiscount,
} from "@/features/checkout/checkout-quote";
import { formatDiscountCountdown } from "@/features/checkout/format-discount-countdown";
import { type Locale, m } from "@/features/i18n";
import { useDiscountCountdownState } from "./use-discount-countdown-state";

export function CheckoutDiscountCountdownBanner({
  locale,
  summary,
}: {
  readonly locale: Locale;
  readonly summary: CheckoutSummary;
}) {
  return getCheckoutSummaryDiscounts(summary).map((discount) => (
    <ActiveDiscountCountdownBanner
      discount={discount}
      key={discount.id}
      locale={locale}
    />
  ));
}

function getCheckoutSummaryDiscounts(summary: CheckoutSummary) {
  const discounts = new Map<
    CheckoutSummaryDiscount["discount"]["id"],
    CheckoutSummaryDiscount["discount"]
  >();

  for (const section of summary.sections) {
    if (section.key !== "order") continue;

    for (const item of section.items) {
      if (!("discounts" in item && item.discounts)) continue;

      for (const { discount } of item.discounts) {
        if (!discounts.has(discount.id)) {
          discounts.set(discount.id, discount);
        }
      }
    }
  }

  return [...discounts.values()];
}

function ActiveDiscountCountdownBanner({
  discount,
  locale,
}: {
  readonly discount: CheckoutSummaryDiscount["discount"];
  readonly locale: Locale;
}) {
  const countdownState = useDiscountCountdownState(discount);

  if (countdownState?.status === "expired") {
    return (
      <output className="flex items-start gap-3 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-burned-orange/12 text-burned-orange">
          <AlertTriangle aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 self-center font-semibold">
          {m.checkoutDiscountExpiredBanner(
            { discount: discount.label },
            { locale }
          )}
        </span>
      </output>
    );
  }

  if (
    countdownState?.status !== "active" ||
    countdownState.countdown.unit !== "second"
  ) {
    return null;
  }

  const remaining = formatDiscountCountdown(countdownState.countdown, locale);

  return (
    <output className="flex items-start gap-3 rounded-2xl border border-aquamarine-green/40 bg-aquamarine-green/12 px-4 py-3 text-sm leading-6 text-aquamarine-ink ring-1 ring-aquamarine-green/10">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-aquamarine-green/18 text-aquamarine-ink">
        <Timer aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 self-center font-semibold">
        {m.checkoutDiscountCountdownBanner(
          { discount: discount.label, remaining },
          { locale }
        )}
      </span>
    </output>
  );
}
