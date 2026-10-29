import type { DotyposReservation } from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { getMeetingRoomBookedStart } from "@/features/reservation/meeting-room-early-setup";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
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
 *
 * `start` and `interval` are the booked time. A meeting room booked with early
 * setup is held in Dotypos from `setupStart`, before its booked start;
 * `occupiedInterval` is that held span, which the door code also covers.
 * Without setup, `setupStart` is `none` and `occupiedInterval` equals
 * `interval`.
 */
export type BookedReservation = {
  // The venue clock (C63) reads these instants; it plugs in here.
  readonly start: Option.Option<Temporal.Instant>;
  readonly end: Option.Option<Temporal.Instant>;
  readonly interval: Option.Option<BookedInterval>;
  readonly setupStart: Option.Option<Temporal.Instant>;
  readonly occupiedInterval: Option.Option<BookedInterval>;
  readonly seats: Option.Option<number>;
};

const decodeInstant = Schema.decodeUnknownOption(instantFromIsoStringSchema);
const decodeInterval = Schema.decodeUnknownOption(reservationIntervalSchema);
const decodeSeats = Schema.decodeUnknownOption(dotyposReservationSeatsSchema);

const hasEarlySetup = (
  details: StoredWorkspaceReservationDetails | undefined
) => details?.kind === "meeting-room" && details.earlySetup === true;

const toInterval = (
  start: Option.Option<Temporal.Instant>,
  end: Option.Option<Temporal.Instant>,
  bounds: { readonly startsAt: unknown; readonly endsAt: unknown }
): Option.Option<BookedInterval> =>
  Option.all({ startsAt: start, endsAt: end }).pipe(
    Option.filter(() => Option.isSome(decodeInterval(bounds)))
  );

/**
 * The booked start of a Dotypos reservation or a reservation record alone,
 * which is `decodeBookedReservation`'s `start` without decoding the other
 * facts. Lists that order or date thousands of reservations read this.
 */
export const decodeBookedStart = (
  reservation: Pick<DotyposReservation, "startDate">,
  details?: StoredWorkspaceReservationDetails
): Option.Option<Temporal.Instant> => {
  const heldStart = decodeInstant(reservation.startDate);
  return hasEarlySetup(details)
    ? Option.map(heldStart, getMeetingRoomBookedStart)
    : heldStart;
};

/**
 * Decodes the booked facts of a Dotypos reservation or a reservation record.
 * Pass the reservation's stored details when it has them, so an early-setup
 * meeting room decodes to its booked time rather than the span Dotypos holds.
 * Without details, the booked time is the held span. Caches hold the provider
 * fields; decode after reading them, since `Option` doesn't survive cache
 * serialization.
 */
export const decodeBookedReservation = (
  reservation: Pick<DotyposReservation, "startDate" | "endDate" | "seats">,
  details?: StoredWorkspaceReservationDetails
): BookedReservation => {
  const heldStart = decodeInstant(reservation.startDate);
  const end = decodeInstant(reservation.endDate);
  const occupiedInterval = toInterval(heldStart, end, {
    startsAt: reservation.startDate,
    endsAt: reservation.endDate,
  });

  if (!hasEarlySetup(details)) {
    return {
      start: heldStart,
      end,
      interval: occupiedInterval,
      setupStart: Option.none(),
      occupiedInterval,
      seats: decodeSeats(reservation.seats),
    };
  }

  const start = decodeBookedStart(reservation, details);
  return {
    start,
    end,
    interval: toInterval(start, end, {
      startsAt: Option.getOrUndefined(Option.map(start, String)),
      endsAt: reservation.endDate,
    }),
    setupStart: heldStart,
    occupiedInterval,
    seats: decodeSeats(reservation.seats),
  };
};
