/**
 * The reservation page query parameter for its step: absent while the
 * customer picks the space, `contact` at the contact-details step.
 */
export const reservationCheckoutStepQueryParam = "step";

/** The steps a reservation page goes through before payment. */
export type ReservationCheckoutStep = "selection" | "contact";

export const getReservationCheckoutStep = (
  value: string | null | undefined
): ReservationCheckoutStep => (value === "contact" ? "contact" : "selection");
