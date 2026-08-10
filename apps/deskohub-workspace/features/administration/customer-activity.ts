import type { AdministrationReservationSummary } from "./administration.service";

export type CustomerReservationGroups = {
  readonly currentAndFuture: readonly AdministrationReservationSummary[];
  readonly past: readonly AdministrationReservationSummary[];
  readonly unavailable: readonly AdministrationReservationSummary[];
};

export const groupCustomerReservations = (
  reservations: readonly AdministrationReservationSummary[],
  now: Temporal.Instant = Temporal.Now.instant()
): CustomerReservationGroups => {
  const currentAndFuture: AdministrationReservationSummary[] = [];
  const past: AdministrationReservationSummary[] = [];
  const unavailable: AdministrationReservationSummary[] = [];

  for (const reservation of reservations) {
    if (!reservation.endsAt) {
      unavailable.push(reservation);
    } else if (Temporal.Instant.compare(reservation.endsAt, now) < 0) {
      past.push(reservation);
    } else {
      currentAndFuture.push(reservation);
    }
  }

  return { currentAndFuture, past, unavailable };
};
