import type { Reservation } from "@deskohub/dotypos/generated";
import {
  type ReservationDateRange,
  reservationDateRangesOverlap,
} from "@/features/reservation/schemas/reservation-interval";

export const workspaceBookingGuestCount = 1;

export const getWorkspaceTableOccupancyById = (
  reservations: readonly Reservation[],
  range: Pick<ReservationDateRange, "startMs" | "endMs">
) => {
  const occupancyByTableId = new Map<string, number>();

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
