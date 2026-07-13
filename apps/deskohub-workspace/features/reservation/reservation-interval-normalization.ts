import { Data, Effect, Option, Schema } from "effect";
import {
  instantEffectSchema,
  localDateTimeEffectSchema,
  localTimeEffectSchema,
} from "@/shared/utils/temporal";

export type ReservationInterval = {
  readonly startsAt: string;
  readonly endsAt: string;
};

export type ReservationIntervalInput = Partial<ReservationInterval> & {
  readonly date?: string;
  readonly durationMinutes?: number;
};

export type ReservationIntervalValidationIssue = {
  readonly path: keyof ReservationInterval;
  readonly message: string;
};

export class ReservationIntervalValidationError extends Data.TaggedError(
  "ReservationIntervalValidationError"
)<ReservationIntervalValidationIssue & { readonly cause?: unknown }> {}

export const defaultReservationInterval = {
  startsAt: "00:00",
  endsAt: "24:00",
} as const satisfies ReservationInterval;

const reservationLocalTimeEffectSchema = Schema.Union([
  Schema.Literal("24:00"),
  localTimeEffectSchema,
]);

const decodeReservationLocalTime = Schema.decodeUnknownOption(
  reservationLocalTimeEffectSchema
);
const decodeLocalDateTime = Schema.decodeUnknownOption(
  localDateTimeEffectSchema
);
const decodeInstant = Schema.decodeUnknownOption(instantEffectSchema);

export const normalizeReservationIntervalFields = (
  value: ReservationIntervalInput,
  timeZone: string
): Effect.Effect<ReservationInterval, ReservationIntervalValidationError> =>
  Effect.gen(function* () {
    const hasExplicitInterval =
      value.startsAt !== undefined || value.endsAt !== undefined;
    const startsAt = value.startsAt ?? defaultReservationInterval.startsAt;
    const endsAt = value.endsAt ?? defaultReservationInterval.endsAt;
    const date = value.date;
    const normalizedStartsAt = yield* normalizeTimestampField({
      date,
      path: "startsAt",
      timeZone,
      value: startsAt,
    });
    const normalizedEndsAt = yield* normalizeTimestampField({
      date,
      path: "endsAt",
      startsAt,
      timeZone,
      value: endsAt,
    });
    const interval = {
      startsAt: normalizedStartsAt,
      endsAt: normalizedEndsAt,
    };
    const durationMinutes = getDurationMinutes(interval);

    if (durationMinutes <= 0) {
      return yield* Effect.fail(
        new ReservationIntervalValidationError({
          path: "endsAt",
          message: "Reservation end time must be after start time.",
        })
      );
    }

    if (
      value.date &&
      hasExplicitInterval &&
      toPlainDateTime(interval.startsAt, timeZone).toPlainDate().toString() !==
        value.date
    ) {
      return yield* Effect.fail(
        new ReservationIntervalValidationError({
          path: "startsAt",
          message: "Reservation start time must match reservation date.",
        })
      );
    }

    if (
      value.durationMinutes !== undefined &&
      durationMinutes !== value.durationMinutes
    ) {
      return yield* Effect.fail(
        new ReservationIntervalValidationError({
          path: "endsAt",
          message: "Reservation duration must match start and end time.",
        })
      );
    }

    return interval;
  });

export const getDurationMinutes = (interval: ReservationInterval) =>
  (toInstantMilliseconds(interval.endsAt) -
    toInstantMilliseconds(interval.startsAt)) /
  (60 * 1000);

export const toInstantMilliseconds = (value: string) =>
  Temporal.Instant.from(value).epochMilliseconds;

export const toPlainDateTime = (value: string, timeZone: string) =>
  Temporal.Instant.from(value).toZonedDateTimeISO(timeZone).toPlainDateTime();

const normalizeTimestampField = ({
  date,
  path,
  startsAt,
  timeZone,
  value,
}: {
  readonly date?: string;
  readonly path: keyof ReservationInterval;
  readonly startsAt?: string;
  readonly timeZone: string;
  readonly value: string;
}): Effect.Effect<string, ReservationIntervalValidationError> => {
  const localTime = decodeReservationLocalTime(value);
  if (Option.isSome(localTime)) {
    if (!date) {
      return Effect.fail(
        new ReservationIntervalValidationError({
          path,
          message: "Reservation date is required for local time inputs.",
        })
      );
    }

    return Effect.try({
      try: () =>
        localTimeToInstant({ date, startsAt, time: localTime.value, timeZone }),
      catch: (cause) => toValidationError(path, cause),
    });
  }

  const localDateTime = decodeLocalDateTime(value);
  if (Option.isSome(localDateTime)) {
    return Effect.try({
      try: () =>
        Temporal.PlainDateTime.from(localDateTime.value)
          .toZonedDateTime(timeZone)
          .toInstant()
          .toString(),
      catch: (cause) => toValidationError(path, cause),
    });
  }

  const instant = decodeInstant(value);
  if (Option.isSome(instant)) {
    return Effect.try({
      try: () => Temporal.Instant.from(instant.value).toString(),
      catch: (cause) => toValidationError(path, cause),
    });
  }

  return Effect.fail(
    new ReservationIntervalValidationError({
      path,
      message: "Reservation start and end must be valid timestamps.",
    })
  );
};

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
  const reservationDate = Temporal.PlainDate.from(date);
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
