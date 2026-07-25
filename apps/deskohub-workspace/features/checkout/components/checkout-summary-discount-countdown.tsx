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
    let interval: ReturnType<typeof setInterval> | undefined;
    const updateCountdown = () => {
      const state = getDiscountCountdownState(
        { countdownStartsAt, expiresAt },
        Temporal.Now.instant()
      );
      setCountdown(state.countdown);
      return state;
    };

    const scheduleCountdown = () => {
      const state = updateCountdown();
      if (state.refreshEveryMilliseconds !== undefined) {
        interval = setInterval(() => {
          const nextState = updateCountdown();
          if (nextState.refreshEveryMilliseconds === undefined) {
            clearInterval(interval);
            interval = undefined;
          }
        }, state.refreshEveryMilliseconds);
        return;
      }
      if (state.refreshAfterMilliseconds !== undefined) {
        timeout = setTimeout(
          scheduleCountdown,
          Math.min(state.refreshAfterMilliseconds, maximumTimeoutMilliseconds)
        );
      }
    };

    scheduleCountdown();

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [countdownStartsAt, expiresAt]);

  if (!countdown) {
    return null;
  }

  const remainingUnits =
    countdown.unit === "second"
      ? [
          { value: Math.floor(countdown.value / 60), unit: "minute" as const },
          { value: countdown.value % 60, unit: "second" as const },
        ].filter(({ value }) => value > 0)
      : [countdown];
  const remaining = new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(
    remainingUnits.map(({ value, unit }) =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "long",
      }).format(value)
    )
  );

  return (
    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-burned-orange">
      <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
      {m.checkoutSummaryDiscountEnds({ remaining }, { locale })}
    </span>
  );
}
