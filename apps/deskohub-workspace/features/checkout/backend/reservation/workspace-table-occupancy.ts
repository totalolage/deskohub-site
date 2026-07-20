import type { Reservation } from "@deskohub/dotypos/generated";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";

export const workspaceBookingGuestCount = 1;

export const getWorkspaceTableOccupancyById = (
  reservations: readonly Reservation[],
  input: ReservationInterval | Temporal.PlainDate
) => {
  const occupancyByTableId = new Map<string, number>();
  const startsAt =
    input instanceof Temporal.PlainDate
      ? input.toZonedDateTime({ timeZone: reservationTimeZone }).toInstant()
          .epochMilliseconds
      : Temporal.Instant.from(input.startsAt).epochMilliseconds;
  const endsAt =
    input instanceof Temporal.PlainDate
      ? input
          .add({ days: 1 })
          .toZonedDateTime({ timeZone: reservationTimeZone })
          .toInstant().epochMilliseconds
      : Temporal.Instant.from(input.endsAt).epochMilliseconds;

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

    if (reservationStart < endsAt && reservationEnd > startsAt) {
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
