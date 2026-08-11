import type {
  DotyposReservation,
  DotyposReservationId,
  DotyposReservationInterval,
  DotyposTableId,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import type { ReservationInterval } from "@/features/reservation/reservation-interval";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

export const workspaceBookingSeatCount = 1;

const decodeReservationSeats = Schema.decodeUnknownOption(
  dotyposReservationSeatsSchema
);

export const getWorkspaceTableOccupancyById = (
  reservations: readonly DotyposReservation[],
  input: ReservationInterval | Temporal.PlainDate
) => {
  const occupancyByTableId = new Map<DotyposTableId, number>();
  const interval = getWorkspaceReservationIntervalDates(input);
  const startsAt = interval.startDate.getTime();
  const endsAt = interval.endDate.getTime();

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
          Option.getOrElse(decodeReservationSeats(reservation.seats), () => 1)
      );
    }
  }

  return occupancyByTableId;
};

export const getWorkspaceReservationIntervalDates = (
  input: ReservationInterval | Temporal.PlainDate
): DotyposReservationInterval => {
  const startsAt =
    input instanceof Temporal.PlainDate
      ? input
          .toZonedDateTime({
            timeZone: workspaceSiteConstants.location.timeZone,
          })
          .toInstant().epochMilliseconds
      : Temporal.Instant.from(input.startsAt).epochMilliseconds;
  const endsAt =
    input instanceof Temporal.PlainDate
      ? input
          .add({ days: 1 })
          .toZonedDateTime({
            timeZone: workspaceSiteConstants.location.timeZone,
          })
          .toInstant().epochMilliseconds
      : Temporal.Instant.from(input.endsAt).epochMilliseconds;

  return { startDate: new Date(startsAt), endDate: new Date(endsAt) };
};

export const excludeDotyposReservationsById = (
  reservations: readonly DotyposReservation[],
  excludedDotyposReservationIds: readonly DotyposReservationId[]
) => {
  if (excludedDotyposReservationIds.length === 0) return reservations;

  const excludedIds = new Set(excludedDotyposReservationIds);
  return reservations.filter(
    (reservation) => !reservation.id || !excludedIds.has(reservation.id)
  );
};
