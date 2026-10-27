import type { DotyposReservation } from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { instantFromIsoStringSchema } from "@/shared/utils/temporal";

/** A booked span whose end follows its start. */
export type BookedInterval = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

/**
 * What a Dotypos reservation books, decoded once. Each fact is `none` when
 * Dotypos returned a value Workspace can't read, so every caller states its
 * own fallback. `start` and `end` decode on their own: a reservation with an
 * unreadable end still has a start to order by. `interval` is `some` only
 * when both bounds decode and the end is after the start.
 */
export type BookedReservation = {
  // The venue clock (C63) reads these instants; it plugs in here.
  readonly start: Option.Option<Temporal.Instant>;
  readonly end: Option.Option<Temporal.Instant>;
  readonly interval: Option.Option<BookedInterval>;
  readonly seats: Option.Option<number>;
};

const decodeInstant = Schema.decodeUnknownOption(instantFromIsoStringSchema);
const decodeInterval = Schema.decodeUnknownOption(reservationIntervalSchema);
const decodeSeats = Schema.decodeUnknownOption(dotyposReservationSeatsSchema);

/**
 * Decodes the booked facts of a Dotypos reservation or a reservation record.
 * Caches hold the provider fields; decode after reading them, since `Option`
 * doesn't survive cache serialization.
 */
export const decodeBookedReservation = (
  reservation: Pick<DotyposReservation, "startDate" | "endDate" | "seats">
): BookedReservation => {
  const start = decodeInstant(reservation.startDate);
  const end = decodeInstant(reservation.endDate);

  return {
    start,
    end,
    interval: Option.all({ startsAt: start, endsAt: end }).pipe(
      Option.filter(() =>
        Option.isSome(
          decodeInterval({
            startsAt: reservation.startDate,
            endsAt: reservation.endDate,
          })
        )
      )
    ),
    seats: decodeSeats(reservation.seats),
  };
};
