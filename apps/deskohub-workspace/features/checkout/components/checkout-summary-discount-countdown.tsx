"use client";

import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import {
  type DiscountCountdown,
  getDiscountCountdownState,
} from "@/features/checkout/discount-countdown";
import { type Locale, m } from "@/features/i18n";

const maximumTimeoutMilliseconds = 2_147_000_000;

export function CheckoutSummaryDiscountCountdown({
  discount,
  locale,
}: {
  readonly discount: CheckoutSummaryDiscount["discount"];
  readonly locale: Locale;
}) {
  const { countdownStartsAt, expiresAt } = discount;

  if (!(countdownStartsAt && expiresAt)) {
    return null;
  }

  return (
    <ActiveDiscountCountdown
      countdownStartsAt={countdownStartsAt}
      expiresAt={expiresAt}
      locale={locale}
    />
  );
}

function ActiveDiscountCountdown({
  countdownStartsAt,
  expiresAt,
  locale,
}: {
  readonly countdownStartsAt: string;
  readonly expiresAt: string;
  readonly locale: Locale;
}) {
  const [countdown, setCountdown] = useState<DiscountCountdown>();

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const updateCountdown = () => {
      const state = getDiscountCountdownState(
        { countdownStartsAt, expiresAt },
        Temporal.Now.instant()
      );
      setCountdown(state.countdown);

      if (state.refreshAfterMilliseconds !== undefined) {
        timeout = setTimeout(
          updateCountdown,
          Math.min(state.refreshAfterMilliseconds, maximumTimeoutMilliseconds)
        );
      }
    };

    updateCountdown();

    return () => clearTimeout(timeout);
  }, [countdownStartsAt, expiresAt]);

  if (!countdown) {
    return null;
  }

  const remaining = new Intl.RelativeTimeFormat(locale, {
    numeric: "always",
  }).format(countdown.value, countdown.unit);

  return (
    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-burned-orange">
      <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
      {m.checkoutSummaryDiscountEnds({ remaining }, { locale })}
    </span>
  );
}
