import { expect, mock } from "bun:test";
import { fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ReservationCheckoutStep } from "@/features/reservation/reservation-checkout-step";

/**
 * Keeps a reservation page's step in component state for component tests.
 * The page keeps it in the URL through Next's router, which tests replace
 * with mocks that don't follow `history.pushState`. Call it before importing
 * the form under test.
 */
export const mockReservationCheckoutStep = () => {
  const step = { initial: "selection" as ReservationCheckoutStep };
  mock.module(
    "@/features/reservation/components/use-reservation-checkout-step",
    () => ({
      useReservationCheckoutStep: () => {
        const [current, setCurrent] = useState(step.initial);
        return { goTo: setCurrent, step: current };
      },
    })
  );
  return step;
};

/**
 * Continues from the space to the contact details with the reservation
 * form's one action button, then submits the booking with it.
 */
export const continueAndSubmitReservation = async (
  button: HTMLButtonElement
) => {
  fireEvent.click(button);
  await waitFor(() => expect(button.id).toBe("reservation-submit"));
  fireEvent.click(button);
};
