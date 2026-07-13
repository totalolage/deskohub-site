import type { Reservation } from "@deskohub/dotypos/generated";
import {
  type ReservationDateRange,
  reservationDateRangesOverlap,
} from "@/features/reservation/reservation-interval";

export const workspaceBookingGuestCount = 1;

export const getWorkspaceTableOccupancyById = (
  reservations: readonly Reservation[],
  input:
    | Pick<ReservationDateRange, "startMs" | "endMs">
    | Temporal.PlainDate
) => {
  const occupancyByTableId = new Map<string, number>();
  const range =
    input instanceof Temporal.PlainDate ? getPragueDayRange(input) : input;

  for (const reservation of reservations) {
    if (reservation.status !== "NEW" && reservation.status !== "CONFIRMED") {
      continue;
    }
    const tableId = reservation._tableId;
    if (!tableId) continue;

    const reservationStart = Date.parse(reservation.startDate);
    const reservationEnd = Date.parse(reservation.endDate);
    if (
      !Number.isFinite(reservationStart) ||
      !Number.isFinite(reservationEnd)
    ) {
      continue;
    }

    if (
      reservationDateRangesOverlap(
        { startMs: reservationStart, endMs: reservationEnd },
        range
      )
    ) {
      occupancyByTableId.set(
        tableId,
        (occupancyByTableId.get(tableId) ?? 0) +
          (parsePositiveNumber(reservation.seats) ?? 1)
      );
    }
  }

  return occupancyByTableId;
};

const getPragueDayRange = (date: Temporal.PlainDate) => ({
  startMs: date
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds,
  endMs: date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds,
});

export const excludeExpiredLocalHolds = (
  reservations: readonly Reservation[],
  expiredDotyposReservationIds: readonly string[]
) => {
  if (expiredDotyposReservationIds.length === 0) return reservations;

  const expiredIds = new Set(expiredDotyposReservationIds);
  return reservations.filter(
    (reservation) => !reservation.id || !expiredIds.has(reservation.id)
  );
};

const parsePositiveNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
