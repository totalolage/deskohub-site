"use client";

import { useEffect, useState } from "react";
import type { CheckoutSummaryDiscount } from "@/features/checkout/checkout-quote";
import {
  type DiscountCountdownState,
  getDiscountCountdownState,
} from "@/features/checkout/discount-countdown";

const maximumTimeoutMilliseconds = 2_147_000_000;

export function useDiscountCountdownState(
  discount: CheckoutSummaryDiscount["discount"]
) {
  const { countdownStartsAt, expiresAt } = discount;
  const [state, setState] = useState<DiscountCountdownState>();

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
      setState(state);
      return state;
    };

    const scheduleCountdown = () => {
      const state = updateCountdown();
      if (
        state.status === "active" &&
        state.refreshEveryMilliseconds !== undefined
      ) {
        interval = setInterval(() => {
          const nextState = updateCountdown();
          if (
            nextState.status !== "active" ||
            nextState.refreshEveryMilliseconds === undefined
          ) {
            clearInterval(interval);
            interval = undefined;
          }
        }, state.refreshEveryMilliseconds);
        return;
      }
      if (
        (state.status === "scheduled" || state.status === "active") &&
        state.refreshAfterMilliseconds !== undefined
      ) {
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

  return countdownStartsAt && expiresAt ? state : undefined;
}
