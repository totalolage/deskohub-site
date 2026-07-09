import "@/shared/polyfills/temporal";

import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
} from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";

export type MeetingRoomReservationInterval = {
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: WorkspaceMeetingRoomDurationMinutes;
};

export const getMeetingRoomReservationInterval = (
  startDateTime: string,
  durationMinutes: number
): MeetingRoomReservationInterval | null => {
  if (!isWorkspaceMeetingRoomDuration(durationMinutes)) return null;

  try {
    const startPlainDateTime = Temporal.PlainDateTime.from(startDateTime);
    const startInstant = startPlainDateTime
      .toZonedDateTime(reservationTimeZone)
      .toInstant();
    const endInstant = startInstant.add({ minutes: durationMinutes });

    return {
      date: startPlainDateTime.toPlainDate().toString(),
      startsAt: startInstant.toString(),
      endsAt: endInstant.toString(),
      durationMinutes,
    };
  } catch {
    return null;
  }
};

export const getMeetingRoomAvailabilityToDate = ({
  endsAt,
}: Pick<MeetingRoomReservationInterval, "endsAt">) => {
  const lastTouchedInstant = Temporal.Instant.fromEpochMilliseconds(
    Temporal.Instant.from(endsAt).epochMilliseconds - 1
  );

  return lastTouchedInstant
    .toZonedDateTimeISO(reservationTimeZone)
    .toPlainDate()
    .toString();
};
