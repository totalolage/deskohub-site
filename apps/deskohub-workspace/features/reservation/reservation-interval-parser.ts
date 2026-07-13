import { Effect, Match, Schema, SchemaGetter } from "effect";
import {
  type Instant,
  instantStringEffectSchema,
  type LocalDateTime,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";
import {
  type ReservationInterval,
  ReservationIntervalValidationError,
} from "./reservation-interval-domain";

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
      encode: SchemaGetter.transform(({ value }) => value as LocalDateTime),
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
      encode: SchemaGetter.transform(({ value }) => value as Instant),
    }
  )
);

const reservationTimestampEffectSchema = Schema.Union([
  localDateTimeTimestampEffectSchema,
  instantTimestampEffectSchema,
]);

const decodeReservationTimestamp = Schema.decodeUnknownEffect(
  reservationTimestampEffectSchema
);
const decodeInstantString = Schema.decodeUnknownSync(instantStringEffectSchema);

export const toPlainDateTime = (value: Instant, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime();

export const toInstantMilliseconds = (value: Instant) =>
  Temporal.Instant.from(value).epochMilliseconds;

type TimestampFieldInput = {
  readonly path: keyof ReservationInterval;
  readonly timeZone: string;
  readonly value: Instant | LocalDateTime;
};

export const normalizeTimestampField = ({
  path,
  timeZone,
  value,
}: TimestampFieldInput): Effect.Effect<
  Instant,
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

const toValidationError = (path: keyof ReservationInterval, cause: unknown) =>
  new ReservationIntervalValidationError({
    path,
    message:
      cause instanceof Error
        ? cause.message
        : "Reservation start and end must be valid timestamps.",
    cause,
  });
