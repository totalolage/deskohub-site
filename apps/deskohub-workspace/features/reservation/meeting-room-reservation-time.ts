import { Option, Schema } from "effect";
import {
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  type LocalDateTime,
  localDateTimeSchema,
} from "@/shared/utils/temporal";

const decodeInstant = Schema.decodeUnknownOption(instantStringSchema);
const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);
const localDateTimeToMeetingRoomStartInstant = Option.liftThrowable(
  (startDateTime: LocalDateTime | Temporal.PlainDateTime) =>
    Temporal.PlainDateTime.from(startDateTime)
      .toZonedDateTime(workspaceSiteConstants.location.timeZone, {
        disambiguation: "reject",
      })
      .toInstant()
);

const roundUpToWholePragueHour = (instant: Temporal.Instant) => {
  const dateTime = instant.toZonedDateTimeISO(
    workspaceSiteConstants.location.timeZone
  );
  const wholeHour = dateTime.with({
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });

  return dateTime.equals(wholeHour) ? wholeHour : wholeHour.add({ hours: 1 });
};

export const getEarliestMeetingRoomStartDateTime = (
  duration: MeetingRoomReservationDuration,
  now = Temporal.Now.instant()
) => {
  if (isMeetingRoomWholeDayReservationDuration(duration)) {
    return now
      .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
      .toPlainDate()
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" });
  }

  return roundUpToWholePragueHour(now.subtract({ hours: duration.amount }))
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
};

export const getMeetingRoomReservationInterval = (
  startDateTime: string,
  duration: MeetingRoomReservationDuration
): ReservationInterval | null => {
  const isWholeDay = isMeetingRoomWholeDayReservationDuration(duration);

  return decodeLocalDateTime(startDateTime).pipe(
    Option.flatMap((selectedStartDateTime) => {
      const selectedPlainDateTime = Temporal.PlainDateTime.from(
        selectedStartDateTime
      );
      const startDateTime = isWholeDay
        ? selectedPlainDateTime.toPlainDate().toPlainDateTime()
        : selectedPlainDateTime;

      return localDateTimeToMeetingRoomStartInstant(startDateTime).pipe(
        Option.flatMap((startInstant) => {
          const endInstant = isWholeDay
            ? localDateTimeToMeetingRoomStartInstant(
                startDateTime.add({ days: 1 })
              )
            : Option.some(startInstant.add({ hours: duration.amount }));

          return endInstant.pipe(
            Option.flatMap((end) =>
              Option.all({
                startsAt: decodeInstant(startInstant.toString()),
                endsAt: decodeInstant(end.toString()),
              })
            )
          );
        })
      );
    }),
    Option.getOrNull
  );
};

export const getMeetingRoomAvailabilityToDate = ({
  endsAt,
}: Pick<ReservationInterval, "endsAt">) => {
  const lastTouchedInstant = Temporal.Instant.fromEpochMilliseconds(
    Temporal.Instant.from(endsAt).epochMilliseconds - 1
  );

  return lastTouchedInstant
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();
};

export const getMeetingRoomReservationDate = ({
  startsAt,
}: Pick<ReservationInterval, "startsAt">) =>
  Temporal.Instant.from(startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();
