import { Option, Schema } from "effect";
import {
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
  meetingRoomReservationDurations,
} from "@/features/reservation/meeting-room-reservation-duration";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  type LocalDateTime,
  localDateTimeSchema,
  type PlainDate,
  plainDateStringSchema,
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

/**
 * Last Prague calendar date a meeting-room interval occupies. The end is
 * exclusive, so a booking ending exactly at midnight belongs to the previous
 * day.
 */
export const getMeetingRoomLastServiceDate = ({
  endsAt,
}: Pick<ReservationInterval, "endsAt">): PlainDate => {
  const lastTouchedInstant = Temporal.Instant.fromEpochMilliseconds(
    Temporal.Instant.from(endsAt).epochMilliseconds - 1
  );

  return plainDateStringSchema.make(
    lastTouchedInstant
      .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
      .toPlainDate()
      .toString()
  );
};

/** The Prague wall-clock start that the meeting-room form and links use. */
export const getMeetingRoomStartDateTime = (startsAt: Temporal.Instant) =>
  startsAt
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });

export const getMeetingRoomReservationDate = ({
  startsAt,
}: Pick<ReservationInterval, "startsAt">) =>
  Temporal.Instant.from(startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

/**
 * The purchasable duration whose interval from the booked start exactly
 * matches the booked interval, so a past reservation can preselect it.
 */
export const findMeetingRoomReservationDuration = (interval: {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}): MeetingRoomReservationDuration | undefined => {
  const startDateTime = getMeetingRoomStartDateTime(interval.startsAt);

  return meetingRoomReservationDurations.find((duration) => {
    const candidate = getMeetingRoomReservationInterval(
      startDateTime,
      duration
    );
    return (
      candidate !== null &&
      Temporal.Instant.compare(candidate.startsAt, interval.startsAt) === 0 &&
      Temporal.Instant.compare(candidate.endsAt, interval.endsAt) === 0
    );
  });
};

/** The form offers whole-hour starts up to this hour of each Prague date. */
const lastMeetingRoomStartHour = 23;

/**
 * Last Prague date any meeting-room booking starting on a date can occupy:
 * the date's last start booked for the longest duration. Every availability
 * read for a start date loads inventory through this date, so single checks
 * and the date's start-times list share one shared-snapshot entry.
 */
export const getMeetingRoomDayLastServiceDate = (
  date: PlainDate
): PlainDate => {
  const lastStartDateTime = Temporal.PlainDate.from(date)
    .toPlainDateTime({ hour: lastMeetingRoomStartHour })
    .toString({ smallestUnit: "minute" });

  return meetingRoomReservationDurations.reduce((lastServiceDate, duration) => {
    const interval = getMeetingRoomReservationInterval(
      lastStartDateTime,
      duration
    );
    const durationLastServiceDate = interval
      ? getMeetingRoomLastServiceDate(interval)
      : lastServiceDate;
    return durationLastServiceDate > lastServiceDate
      ? durationLastServiceDate
      : lastServiceDate;
  }, date);
};

/** A start the meeting-room form accepts, with the interval it books. */
export type MeetingRoomStartTime = {
  readonly startDateTime: LocalDateTime;
  readonly interval: ReservationInterval;
};

/**
 * Every start the meeting-room form accepts on a Prague date for a duration:
 * each whole hour from the earliest start, or the date's midnight for a whole
 * day. Wall times that daylight saving skips or repeats book no interval, so
 * they are left out.
 */
export const getMeetingRoomDayStartTimes = ({
  date,
  duration,
  now,
}: {
  readonly date: PlainDate;
  readonly duration: MeetingRoomReservationDuration;
  readonly now: Temporal.Instant;
}): ReadonlyArray<MeetingRoomStartTime> => {
  const earliestStart = Temporal.PlainDateTime.from(
    getEarliestMeetingRoomStartDateTime(duration, now)
  );
  const midnight = Temporal.PlainDate.from(date).toPlainDateTime();
  const candidates = isMeetingRoomWholeDayReservationDuration(duration)
    ? [midnight]
    : Array.from({ length: lastMeetingRoomStartHour + 1 }, (_, hour) =>
        midnight.with({ hour })
      );

  return candidates.flatMap((candidate) => {
    if (Temporal.PlainDateTime.compare(candidate, earliestStart) < 0) return [];

    const startDateTime = localDateTimeSchema.make(
      candidate.toString({ smallestUnit: "minute" })
    );
    const interval = getMeetingRoomReservationInterval(startDateTime, duration);
    return interval ? [{ startDateTime, interval }] : [];
  });
};
