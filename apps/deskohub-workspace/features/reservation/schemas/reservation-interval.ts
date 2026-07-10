import {
  Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  defaultReservationInterval,
  getDurationMinutes,
  normalizeReservationIntervalFields,
  type ReservationInterval,
  type ReservationIntervalInput,
  ReservationIntervalValidationError,
  toInstantMilliseconds,
  toPlainDateTime,
} from "@/features/reservation/schemas/reservation-interval-normalization";
import { temporalInstantToPlainDate } from "@/shared/utils/temporal";

export type {
  ReservationInterval,
  ReservationIntervalInput,
} from "@/features/reservation/schemas/reservation-interval-normalization";
export { defaultReservationInterval };

export type ReservationDateInterval = ReservationInterval & {
  readonly date: string;
};

export type ReservationDateRange = {
  readonly startDate: Date;
  readonly endDate: Date;
  readonly startMs: number;
  readonly endMs: number;
};

export class ReservationIntervalError extends Data.TaggedError(
  "ReservationIntervalError"
)<{ readonly message: string; readonly cause?: unknown }> {}

export const reservationIntervalInputEffectSchema = Schema.Struct({
  date: Schema.optional(Schema.String),
  durationMinutes: Schema.optional(Schema.Number),
  startsAt: Schema.optional(Schema.String),
  endsAt: Schema.optional(Schema.String),
});

export const reservationIntervalFieldSchemas = {
  startsAt: reservationIntervalInputEffectSchema.fields.startsAt,
  endsAt: reservationIntervalInputEffectSchema.fields.endsAt,
} as const;

export const reservationIntervalEffectSchema = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
});

export const normalizedReservationIntervalEffectSchema =
  reservationIntervalInputEffectSchema.pipe(
    Schema.decodeTo(reservationIntervalEffectSchema, {
      decode: SchemaGetter.transformOrFail((input) =>
        Effect.try({
          try: () =>
            normalizeReservationIntervalFields(input, reservationTimeZone),
          catch: (cause) => toSchemaIssue(input, cause),
        })
      ),
      encode: SchemaGetter.transform(
        (interval): ReservationIntervalInput => interval
      ),
    })
  );

const decodeReservationInterval = Schema.decodeUnknownSync(
  normalizedReservationIntervalEffectSchema
);

export const isDefaultReservationInterval = (
  interval: ReservationIntervalInput
) => {
  const hasExplicitInterval =
    interval.startsAt !== undefined || interval.endsAt !== undefined;

  try {
    const normalized = normalizeReservationIntervalFields(
      {
        ...(!hasExplicitInterval && { date: "2099-01-01" }),
        ...interval,
      },
      reservationTimeZone
    );
    const start = toPlainDateTime(normalized.startsAt, reservationTimeZone);
    const end = toPlainDateTime(normalized.endsAt, reservationTimeZone);

    return (
      isMidnight(start) &&
      isMidnight(end) &&
      end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }))
    );
  } catch {
    return false;
  }
};

export const getReservationIntervalValidationIssue = (
  interval: ReservationIntervalInput
) => {
  try {
    normalizeReservationIntervalFields(interval, reservationTimeZone);
    return null;
  } catch (cause) {
    return cause instanceof ReservationIntervalValidationError
      ? { path: cause.path, message: cause.message }
      : {
          path: "endsAt" as const,
          message:
            cause instanceof Error
              ? cause.message
              : "Reservation start and end must be valid timestamps.",
        };
  }
};

export const unsafeNormalizeReservationInterval = <T extends object>(
  value: T
): Omit<T, "durationMinutes"> & ReservationInterval => {
  const interval = decodeReservationInterval(value);
  const { durationMinutes: _durationMinutes, ...rest } = value as T & {
    readonly durationMinutes?: number;
  };

  return { ...rest, ...interval } as Omit<T, "durationMinutes"> &
    ReservationInterval;
};

export const normalizeReservationInterval = Effect.fn(
  "normalizeReservationInterval"
)(function* <T extends object>(value: T) {
  return yield* Effect.try({
    try: () => unsafeNormalizeReservationInterval(value),
    catch: (cause) =>
      new ReservationIntervalError({
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
        cause,
      }),
  });
});

export const getReservationPragueDateRange = (
  reservation: ReservationIntervalInput
): Effect.Effect<ReservationDateRange, ReservationIntervalError> =>
  Effect.try({
    try: () => {
      const interval = unsafeNormalizeReservationInterval(reservation);
      const startMs = toInstantMilliseconds(interval.startsAt);
      const endMs = toInstantMilliseconds(interval.endsAt);

      return {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        startMs,
        endMs,
      };
    },
    catch: (cause) =>
      new ReservationIntervalError({
        message:
          cause instanceof Error
            ? cause.message
            : "Reservation start and end must be valid timestamps.",
        cause,
      }),
  });

export const getReservationDurationMinutes = getDurationMinutes;

export const getReservationDate = ({
  interval,
  timeZone,
}: {
  readonly interval: ReservationInterval;
  readonly timeZone: string;
}) =>
  temporalInstantToPlainDate({
    instant: Temporal.Instant.from(interval.startsAt),
    timeZone,
  }).toString();

export const reservationDateRangesOverlap = (
  left: Pick<ReservationDateRange, "startMs" | "endMs">,
  right: Pick<ReservationDateRange, "startMs" | "endMs">
) => left.startMs < right.endMs && left.endMs > right.startMs;

const isMidnight = (dateTime: ReturnType<typeof toPlainDateTime>) =>
  dateTime.hour === 0 &&
  dateTime.minute === 0 &&
  dateTime.second === 0 &&
  dateTime.millisecond === 0;

const toSchemaIssue = (input: unknown, cause: unknown) => {
  const issue =
    cause instanceof ReservationIntervalValidationError
      ? cause
      : new ReservationIntervalValidationError(
          {
            path: "endsAt",
            message:
              cause instanceof Error
                ? cause.message
                : "Reservation start and end must be valid timestamps.",
          },
          { cause }
        );

  return new SchemaIssue.Pointer(
    [issue.path],
    new SchemaIssue.InvalidValue(Option.some(input), {
      message: issue.message,
    })
  );
};
