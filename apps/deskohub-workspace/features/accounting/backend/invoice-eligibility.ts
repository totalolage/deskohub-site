/**
 * A reservation whose access code has been delivered: invoices take their
 * fulfilment date from `fulfilledAt`.
 */
export const isFulfilledReservation = <
  Reservation extends {
    readonly fulfillmentState: string;
    readonly fulfilledAt: Temporal.Instant | null;
  },
>(
  reservation: Reservation
): reservation is Reservation & { readonly fulfilledAt: Temporal.Instant } =>
  reservation.fulfillmentState === "fulfilled" &&
  reservation.fulfilledAt !== null;
