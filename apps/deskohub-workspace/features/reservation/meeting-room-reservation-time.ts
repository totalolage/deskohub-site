import { Option, Schema } from "effect";
import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
} from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import {
  instantStringEffectSchema,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";

const decodeInstant = Schema.decodeUnknownOption(instantStringEffectSchema);
const decodeLocalDateTime = Schema.decodeUnknownOption(
  localDateTimeEffectSchema
);
const localDateTimeToMeetingRoomStartInstant = Option.liftThrowable(
  (startDateTime: typeof localDateTimeEffectSchema.Type) =>
    Temporal.PlainDateTime.from(startDateTime)
      .toZonedDateTime(reservationTimeZone, { disambiguation: "reject" })
      .toInstant()
);

export const getEarliestMeetingRoomStartDateTime = (
  durationMinutes: WorkspaceMeetingRoomDurationMinutes,
  now = Temporal.Now.instant()
) => {
  const earliestStart = now
    .subtract({ minutes: durationMinutes })
    .toZonedDateTimeISO(reservationTimeZone);
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
    .toZonedDateTimeISO(reservationTimeZone)
    .toPlainDate()
    .toString();
};
