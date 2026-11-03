/**
 * The server events that record a reservation's lifecycle and its payments'.
 * Checkout sends them under the reservation's ID, and the administration's
 * reservation history reads them back by these names.
 */
export const reservationLifecycleEvents = [
  "reservation started",
  "reservation abandoned",
  "reservation completed",
  "reservation fulfilled",
  "payment started",
  "payment completed",
  "payment abandoned",
  "payment failed",
] as const;

export type ReservationLifecycleEvent =
  (typeof reservationLifecycleEvents)[number];
