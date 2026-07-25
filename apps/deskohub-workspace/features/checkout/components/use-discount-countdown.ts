"use client";

import { useEffect, useState } from "react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import {
  type DiscountCountdown,
  getDiscountCountdownState,
} from "@/features/checkout/discount-countdown";

const maximumTimeoutMilliseconds = 2_147_000_000;

export function useDiscountCountdown(
  discount: CheckoutSummaryDiscount["discount"]
) {
  const { countdownStartsAt, expiresAt } = discount;
  const [countdown, setCountdown] = useState<DiscountCountdown>();

  useEffect(() => {
    if (!(countdownStartsAt && expiresAt)) {
      return;
    }

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

  return countdownStartsAt && expiresAt ? countdown : undefined;
}
