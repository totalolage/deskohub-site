import type { Reservation } from "@deskohub/dotypos/generated";

export const workspaceBookingGuestCount = 1;

export const getWorkspaceTableOccupancyById = (
  reservations: readonly Reservation[],
  day: Temporal.PlainDate
) => {
  const occupancyByTableId = new Map<string, number>();
  const dayRange = getPragueDayRange(day);

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
      reservationStart < dayRange.endMs &&
      reservationEnd > dayRange.startMs
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

const getPragueDayRange = (date: Temporal.PlainDate) => {
  const startMs = date
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;
  const endMs = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone: "Europe/Prague" })
    .toInstant().epochMilliseconds;

  return { startMs, endMs };
};

const parsePositiveNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};
