import "@/shared/polyfills/temporal";

import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
} from "@/features/checkout/product-catalog";

export type MeetingRoomReservationInterval = {
  readonly date: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes: WorkspaceMeetingRoomDurationMinutes;
};

export const meetingRoomDateTimePattern =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

export const getMeetingRoomReservationInterval = (
  startDateTime: string,
  durationMinutes: number
): MeetingRoomReservationInterval | null => {
  if (!meetingRoomDateTimePattern.test(startDateTime)) return null;
  if (!isWorkspaceMeetingRoomDuration(durationMinutes)) return null;

  const [date = ""] = startDateTime.split("T");
  const startInstant = Temporal.PlainDateTime.from(startDateTime)
    .toZonedDateTime("Europe/Prague")
    .toInstant();
  const endInstant = startInstant.add({ minutes: durationMinutes });

  return {
    date,
    startsAt: startInstant.toString(),
    endsAt: endInstant.toString(),
    durationMinutes,
  };
};

export const getMeetingRoomAvailabilityToDate = ({
  endsAt,
}: Pick<MeetingRoomReservationInterval, "endsAt">) => {
  const lastTouchedInstant = Temporal.Instant.fromEpochMilliseconds(
    Temporal.Instant.from(endsAt).epochMilliseconds - 1
  );

  return lastTouchedInstant
    .toZonedDateTimeISO("Europe/Prague")
    .toPlainDate()
    .toString();
};
