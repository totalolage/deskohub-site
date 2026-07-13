import { Schema } from "effect";
import { isWorkspaceMeetingRoomDuration } from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import "@/shared/polyfills/temporal";
import {
  type Instant,
  instantStringEffectSchema,
} from "@/shared/utils/temporal";

const decodeInstant = Schema.decodeUnknownSync(instantStringEffectSchema);

export type MeetingRoomReservationInterval = {
  readonly date: string;
  readonly startsAt: Instant;
  readonly endsAt: Instant;
};

export const getEarliestMeetingRoomStartDateTime = (
  now = Temporal.Now.instant()
) =>
  now
    .toZonedDateTimeISO(reservationTimeZone)
    .with({
      minute: 0,
      second: 0,
      millisecond: 0,
      microsecond: 0,
      nanosecond: 0,
    })
    .add({ hours: 1 })
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });

export const getMeetingRoomReservationInterval = (
  startDateTime: string,
  durationMinutes: number
): MeetingRoomReservationInterval | null => {
  if (!isWorkspaceMeetingRoomDuration(durationMinutes)) return null;

  try {
    const startPlainDateTime = Temporal.PlainDateTime.from(startDateTime);
    const startInstant = startPlainDateTime
      .toZonedDateTime(reservationTimeZone, { disambiguation: "reject" })
      .toInstant();
    const endInstant = startInstant.add({ minutes: durationMinutes });

    return {
      date: startPlainDateTime.toPlainDate().toString(),
      startsAt: decodeInstant(startInstant.toString()),
      endsAt: decodeInstant(endInstant.toString()),
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
