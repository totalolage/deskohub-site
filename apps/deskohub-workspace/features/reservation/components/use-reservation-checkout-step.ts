"use client";

import { useSearchParams } from "next/navigation";
import {
  getReservationCheckoutStep,
  type ReservationCheckoutStep,
  reservationCheckoutStepQueryParam,
} from "@/features/reservation/reservation-checkout-step";

/**
 * The reservation page's step, kept in the URL so Back, a reload, and a
 * sign-in's return path reopen it. Changing it adds a history entry without
 * a server request; Next's App Router keeps `useSearchParams` in step.
 */
export function useReservationCheckoutStep() {
  const step = getReservationCheckoutStep(
    useSearchParams().get(reservationCheckoutStepQueryParam)
  );

  const goTo = (nextStep: ReservationCheckoutStep) => {
    const url = new URL(window.location.href);
    if (nextStep === "contact") {
      url.searchParams.set(reservationCheckoutStepQueryParam, nextStep);
    } else {
      url.searchParams.delete(reservationCheckoutStepQueryParam);
    }
    window.history.pushState(null, "", url);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return { goTo, step };
}
