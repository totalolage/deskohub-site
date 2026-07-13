import { Effect, Match, Option, Schema, SchemaGetter } from "effect";
import {
  type InstantString,
  instantStringEffectSchema,
  type LocalDateTimeString,
  localDateTimeEffectSchema,
  localTimeEffectSchema,
  plainDateStringEffectSchema,
} from "@/shared/utils/temporal";
import {
  type ReservationInterval,
  ReservationIntervalValidationError,
} from "./reservation-interval-domain";

const reservationLocalTimeEffectSchema = Schema.Union([
  Schema.Literal("24:00"),
  localTimeEffectSchema,
]);

const localTimeTimestampEffectSchema = reservationLocalTimeEffectSchema.pipe(
  Schema.decodeTo(
    Schema.TaggedStruct("LocalTime", {
      value: reservationLocalTimeEffectSchema,
    }),
    {
      decode: SchemaGetter.transform((value) => ({
        _tag: "LocalTime" as const,
        value,
      })),
      encode: SchemaGetter.transform(
        ({ value }) => value as typeof reservationLocalTimeEffectSchema.Type
      ),
    }
  )
);

const localDateTimeTimestampEffectSchema = localDateTimeEffectSchema.pipe(
  Schema.decodeTo(
    Schema.TaggedStruct("LocalDateTime", {
      value: localDateTimeEffectSchema,
    }),
    {
      decode: SchemaGetter.transform((value) => ({
        _tag: "LocalDateTime" as const,
        value,
      })),
      encode: SchemaGetter.transform(
        ({ value }) => value as LocalDateTimeString
      ),
    }
  )
);

const instantTimestampEffectSchema = instantStringEffectSchema.pipe(
  Schema.decodeTo(
    Schema.TaggedStruct("Instant", {
      value: instantStringEffectSchema,
    }),
    {
      decode: SchemaGetter.transform((value) => ({
        _tag: "Instant" as const,
        value,
      })),
      encode: SchemaGetter.transform(({ value }) => value as InstantString),
    }
  )
);

const reservationTimestampEffectSchema = Schema.Union([
  localTimeTimestampEffectSchema,
  localDateTimeTimestampEffectSchema,
  instantTimestampEffectSchema,
]);

const decodeReservationTimestamp = Schema.decodeUnknownEffect(
  reservationTimestampEffectSchema
);
const decodeReservationLocalTime = Schema.decodeUnknownOption(
  reservationLocalTimeEffectSchema
);
const decodePlainDateString = Schema.decodeUnknownSync(
  plainDateStringEffectSchema
);
const decodeInstantString = Schema.decodeUnknownSync(instantStringEffectSchema);

export const toPlainDateTime = (value: string, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime();

export const toInstantMilliseconds = (value: string) =>
  Temporal.Instant.from(value).epochMilliseconds;

type TimestampFieldInput = {
  readonly date?: string;
  readonly path: keyof ReservationInterval;
  readonly startsAt?: string;
  readonly timeZone: string;
  readonly value: string;
};

export const normalizeTimestampField = ({
  date,
  path,
  startsAt,
  timeZone,
  value,
}: TimestampFieldInput): Effect.Effect<
  InstantString,
  ReservationIntervalValidationError
> =>
  decodeReservationTimestamp(value).pipe(
    Effect.mapError(
      (cause) =>
        new ReservationIntervalValidationError({
          path,
          message: "Reservation start and end must be valid timestamps.",
          cause,
        })
    ),
    Effect.flatMap((timestamp) =>
      Match.value(timestamp).pipe(
        Match.tag("LocalTime", ({ value: time }) =>
          date
            ? normalizeInstantString(path, () =>
                localTimeToInstant({
                  date,
                  startsAt,
                  time,
                  timeZone,
                })
              )
            : Effect.fail(
                new ReservationIntervalValidationError({
                  path,
                  message:
                    "Reservation date is required for local time inputs.",
                })
              )
        ),
        Match.tag("LocalDateTime", ({ value: localDateTime }) =>
          normalizeInstantString(path, () =>
            Temporal.PlainDateTime.from(localDateTime)
              .toZonedDateTime(timeZone)
              .toInstant()
              .toString()
          )
        ),
        Match.tag("Instant", ({ value: instant }) =>
          normalizeInstantString(path, () =>
            Temporal.Instant.from(instant).toString()
          )
        ),
        Match.exhaustive
      )
    )
  );

const normalizeInstantString = (
  path: keyof ReservationInterval,
  normalize: () => string
) =>
  Effect.try({
    try: () => decodeInstantString(normalize()),
    catch: (cause) => toValidationError(path, cause),
  });

const localTimeToInstant = ({
  date,
  startsAt,
  time,
  timeZone,
}: {
  readonly date: string;
  readonly startsAt?: string;
  readonly time: string;
  readonly timeZone: string;
}) => {
  const reservationDate = Temporal.PlainDate.from(decodePlainDateString(date));
  const minutes = localTimeToMinutes(time);
  const decodedStartTime = startsAt
    ? decodeReservationLocalTime(startsAt)
    : Option.none();
  const startMinutes = Option.isSome(decodedStartTime)
    ? localTimeToMinutes(decodedStartTime.value)
    : undefined;
  const localDate = reservationDate.add({
    days:
      time !== "24:00" && startMinutes !== undefined && minutes <= startMinutes
        ? 1
        : Math.floor(minutes / (24 * 60)),
  });
  const localMinutes = minutes % (24 * 60);

  return localDate
    .toPlainDateTime(
      new Temporal.PlainTime(Math.floor(localMinutes / 60), localMinutes % 60)
    )
    .toZonedDateTime(timeZone)
    .toInstant()
    .toString();
};

const localTimeToMinutes = (time: string) => {
  if (time === "24:00") return 24 * 60;

  const parsed = Temporal.PlainTime.from(time);
  return parsed.hour * 60 + parsed.minute;
};

const toValidationError = (path: keyof ReservationInterval, cause: unknown) =>
  new ReservationIntervalValidationError({
    path,
    message:
      cause instanceof Error
        ? cause.message
        : "Reservation start and end must be valid timestamps.",
    cause,
  });
