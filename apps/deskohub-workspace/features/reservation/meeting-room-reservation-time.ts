import { Option, Schema } from "effect";
import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
} from "@/features/checkout/product-catalog";
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
  (startDateTime: LocalDateTime) =>
    Temporal.PlainDateTime.from(startDateTime)
      .toZonedDateTime(workspaceSiteConstants.location.timeZone, {
        disambiguation: "reject",
      })
      .toInstant()
);

export const getEarliestMeetingRoomStartDateTime = (
  durationMinutes: WorkspaceMeetingRoomDurationMinutes,
  now = Temporal.Now.instant()
) => {
  const earliestStart = now
    .subtract({ minutes: durationMinutes })
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone);
  const wholeHour = earliestStart.with({
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0,
  });

  return (
    earliestStart.equals(wholeHour) ? wholeHour : wholeHour.add({ hours: 1 })
  )
    .toPlainDateTime()
    .toString({ smallestUnit: "minute" });
};

export const getMeetingRoomReservationInterval = (
  startDateTime: string,
  durationMinutes: number
): ReservationInterval | null => {
  if (!isWorkspaceMeetingRoomDuration(durationMinutes)) return null;

  return decodeLocalDateTime(startDateTime).pipe(
    Option.flatMap(localDateTimeToMeetingRoomStartInstant),
    Option.flatMap((startInstant) => {
      const endInstant = startInstant.add({ minutes: durationMinutes });

      return Option.all({
        startsAt: decodeInstant(startInstant.toString()),
        endsAt: decodeInstant(endInstant.toString()),
      }).pipe(Option.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })));
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
