import { Option, Schema } from "effect";
import { isWorkspaceMeetingRoomDuration } from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import "@/shared/polyfills/temporal";
import {
  type Instant,
  instantStringEffectSchema,
  localDateTimeEffectSchema,
  temporalInstantToPlainDate,
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

  return decodeLocalDateTime(startDateTime).pipe(
    Option.flatMap(localDateTimeToMeetingRoomStartInstant),
    Option.flatMap((startInstant) => {
      const endInstant = startInstant.add({ minutes: durationMinutes });

      return Option.all({
        startsAt: decodeInstant(startInstant.toString()),
        endsAt: decodeInstant(endInstant.toString()),
      }).pipe(
        Option.map(({ startsAt, endsAt }) => ({
          date: temporalInstantToPlainDate({
            instant: startInstant,
            timeZone: reservationTimeZone,
          }).toString(),
          startsAt,
          endsAt,
        }))
      );
    }),
    Option.getOrNull
  );
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
