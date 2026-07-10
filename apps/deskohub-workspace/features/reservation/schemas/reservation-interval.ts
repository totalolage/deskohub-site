import {
  Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { isWorkspaceMeetingRoomDuration } from "@/features/checkout/product-catalog";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  defaultReservationInterval,
  getDurationMinutes,
  normalizeReservationIntervalFields,
  type ReservationInterval,
  type ReservationIntervalInput,
  toInstantMilliseconds,
  toPlainDateTime,
} from "@/features/reservation/schemas/reservation-interval-normalization";
import {
  makeWholeHourInstantStringEffectSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

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
        normalizeReservationIntervalFields(input, reservationTimeZone).pipe(
          Effect.mapError((issue) => toSchemaIssue(input, issue))
        )
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

  return Effect.runSync(
    normalizeReservationIntervalFields(
      {
        ...(!hasExplicitInterval && { date: "2099-01-01" }),
        ...interval,
      },
      reservationTimeZone
    ).pipe(
      Effect.map((normalized) => {
        const start = toPlainDateTime(normalized.startsAt, reservationTimeZone);
        const end = toPlainDateTime(normalized.endsAt, reservationTimeZone);

        return (
          isMidnight(start) &&
          isMidnight(end) &&
          end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }))
        );
      }),
      Effect.catch(() => Effect.succeed(false))
    )
  );
};

export const wholeHourReservationInstantEffectSchema =
  makeWholeHourInstantStringEffectSchema(reservationTimeZone);

export const meetingRoomReservationDurationMinutesEffectSchema =
  Schema.Number.check(
    Schema.makeFilter(isWorkspaceMeetingRoomDuration, {
      message: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
    })
  );

const isWholeHourReservationInstant = Schema.is(
  wholeHourReservationInstantEffectSchema
);
const isMeetingRoomReservationDuration = Schema.is(
  meetingRoomReservationDurationMinutesEffectSchema
);

export const coworkReservationIntervalEffectSchema =
  normalizedReservationIntervalEffectSchema.check(
    Schema.makeFilter(isDefaultReservationInterval, {
      message: "Cowork reservations must use the full-day duration.",
    })
  );

export const meetingRoomReservationIntervalEffectSchema =
  normalizedReservationIntervalEffectSchema.check(
    Schema.makeFilter(
      (interval) =>
        isMeetingRoomReservationDuration(getDurationMinutes(interval)),
      {
        message: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
      }
    ),
    Schema.makeFilter(
      (interval) => isWholeHourReservationInstant(interval.startsAt),
      {
        message: "Meeting room reservations must start on a whole hour.",
      }
    )
  );

export const getReservationIntervalValidationIssue = (
  interval: ReservationIntervalInput
) => {
  return Effect.runSync(
    normalizeReservationIntervalFields(interval, reservationTimeZone).pipe(
      Effect.as(null),
      Effect.catch((issue) =>
        Effect.succeed({ path: issue.path, message: issue.message })
      )
    )
  );
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
  const interval = yield* normalizeReservationIntervalFields(
    value as ReservationIntervalInput,
    reservationTimeZone
  ).pipe(
    Effect.mapError(
      (cause) => new ReservationIntervalError({ message: cause.message, cause })
    )
  );
  const { durationMinutes: _durationMinutes, ...rest } = value as T & {
    readonly durationMinutes?: number;
  };

  return { ...rest, ...interval } as Omit<T, "durationMinutes"> &
    ReservationInterval;
});

export const getReservationPragueDateRange = (
  reservation: ReservationIntervalInput
): Effect.Effect<ReservationDateRange, ReservationIntervalError> =>
  normalizeReservationInterval(reservation).pipe(
    Effect.map((interval) => {
      const startMs = toInstantMilliseconds(interval.startsAt);
      const endMs = toInstantMilliseconds(interval.endsAt);

      return {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
        startMs,
        endMs,
      };
    })
  );

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

const toSchemaIssue = (
  input: unknown,
  cause: { readonly path: keyof ReservationInterval; readonly message: string }
) => {
  return new SchemaIssue.Pointer(
    [cause.path],
    new SchemaIssue.InvalidValue(Option.some(input), {
      message: cause.message,
    })
  );
};
