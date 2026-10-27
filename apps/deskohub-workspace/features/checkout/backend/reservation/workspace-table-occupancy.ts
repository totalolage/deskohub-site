import type {
  DotyposReservation,
  DotyposReservationId,
  DotyposReservationInterval,
  DotyposTableId,
} from "@deskohub/dotypos";
import { Option } from "effect";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import type { ReservationRecord } from "@/features/reservation/backend/reservation-record";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const workspaceBookingSeatCount = 1;

/** An active Dotypos reservation's table hold, parsed once for occupancy. */
export type TableBooking = {
  readonly tableId: DotyposTableId;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly seats: number;
};

/** Epoch-millisecond bounds of an occupancy query, end exclusive. */
export type OccupancyWindow = {
  readonly startsAt: number;
  readonly endsAt: number;
};

export const getWorkspaceTableOccupancyById = (
  reservations: readonly ReservationRecord[],
  input: ReservationInterval | Temporal.PlainDate
) =>
  getTableBookingOccupancyById(
    toTableBookings(reservations),
    getOccupancyWindow(input)
  );

/**
 * Keeps only reservations that hold a table: `NEW` or `CONFIRMED`, assigned to
 * a table, and with readable bounds. The bounds aren't checked for order.
 * Unreadable seat counts hold one seat.
 */
export const toTableBookings = (
  reservations: readonly ReservationRecord[]
): readonly TableBooking[] =>
  reservations.flatMap((reservation) => {
    if (reservation.status !== "NEW" && reservation.status !== "CONFIRMED") {
      return [];
    }
    const tableId = reservation._tableId;
    if (!tableId) return [];

    const booked = decodeBookedReservation(reservation);
    return Option.all({ startsAt: booked.start, endsAt: booked.end }).pipe(
      Option.map(({ startsAt, endsAt }) => ({
        tableId,
        startsAt: startsAt.epochMilliseconds,
        endsAt: endsAt.epochMilliseconds,
        seats: Option.getOrElse(booked.seats, () => 1),
      })),
      Option.toArray
    );
  });

export const getTableBookingOccupancyById = (
  bookings: readonly TableBooking[],
  window: OccupancyWindow
) => {
  const occupancyByTableId = new Map<DotyposTableId, number>();

  for (const booking of bookings) {
    if (booking.startsAt < window.endsAt && booking.endsAt > window.startsAt) {
      occupancyByTableId.set(
        booking.tableId,
        (occupancyByTableId.get(booking.tableId) ?? 0) + booking.seats
      );
    }
  }

  return occupancyByTableId;
};

export const getOccupancyWindow = (
  input: ReservationInterval | Temporal.PlainDate
): OccupancyWindow => {
  if (input instanceof Temporal.PlainDate) {
    const timeZone = workspaceSiteConstants.location.timeZone;
    return {
      startsAt: input.toZonedDateTime({ timeZone }).toInstant()
        .epochMilliseconds,
      endsAt: input.add({ days: 1 }).toZonedDateTime({ timeZone }).toInstant()
        .epochMilliseconds,
    };
  }

  return {
    startsAt: Temporal.Instant.from(input.startsAt).epochMilliseconds,
    endsAt: Temporal.Instant.from(input.endsAt).epochMilliseconds,
  };
};

export const getWorkspaceReservationIntervalDates = (
  input: ReservationInterval | Temporal.PlainDate
): DotyposReservationInterval => {
  const window = getOccupancyWindow(input);
  return {
    startDate: new Date(window.startsAt),
    endDate: new Date(window.endsAt),
  };
};

export const excludeDotyposReservationsById = <
  Reservation extends Pick<DotyposReservation, "id">,
>(
  reservations: readonly Reservation[],
  excludedDotyposReservationIds: readonly DotyposReservationId[]
): readonly Reservation[] => {
  if (excludedDotyposReservationIds.length === 0) return reservations;

  const excludedIds = new Set(excludedDotyposReservationIds);
  return reservations.filter(
    (reservation) => !reservation.id || !excludedIds.has(reservation.id)
  );
};
