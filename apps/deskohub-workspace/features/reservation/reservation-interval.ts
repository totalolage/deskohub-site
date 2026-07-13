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
import type {
  ReservationInterval,
  ReservationIntervalInput,
} from "@/features/reservation/reservation-interval-domain";
import {
  getDurationMinutes,
  normalizeReservationIntervalFields,
} from "@/features/reservation/reservation-interval-normalization";
import {
  toInstantMilliseconds,
  toPlainDateTime,
} from "@/features/reservation/reservation-interval-parser";
import {
  instantStringEffectSchema,
  localDateTimeEffectSchema,
  makeWholeHourInstantStringEffectSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

export type {
  ReservationInterval,
  ReservationIntervalInput,
} from "@/features/reservation/reservation-interval-domain";
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
  startsAt: Schema.Union([
    localDateTimeEffectSchema,
    instantStringEffectSchema,
  ]),
  endsAt: Schema.Union([localDateTimeEffectSchema, instantStringEffectSchema]),
});
const decodeReservationIntervalInput = Schema.decodeUnknownSync(
  reservationIntervalInputEffectSchema
);

export const reservationIntervalFieldSchemas = {
  startsAt: reservationIntervalInputEffectSchema.fields.startsAt,
  endsAt: reservationIntervalInputEffectSchema.fields.endsAt,
} as const;

export const reservationIntervalEffectSchema = Schema.Struct({
  startsAt: instantStringEffectSchema,
  endsAt: instantStringEffectSchema,
});

export const normalizedReservationIntervalEffectSchema =
  reservationIntervalInputEffectSchema.pipe(
    Schema.decodeTo(reservationIntervalEffectSchema, {
      decode: SchemaGetter.transformOrFail((input) =>
        normalizeReservationIntervalFields(input, reservationTimeZone).pipe(
          Effect.mapError((issue) => toSchemaIssue(input, issue))
        )
      ),
      encode: SchemaGetter.transform(decodeReservationIntervalInput),
    })
  );

export const isDefaultReservationInterval = (
  interval: ReservationIntervalInput
) => {
  return Effect.runSync(
    normalizeReservationIntervalFields(interval, reservationTimeZone).pipe(
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
  const normalization = getReservationIntervalNormalization(interval);
  return normalization._tag === "Failure"
    ? {
        path: normalization.issue.path,
        message: normalization.issue.message,
      }
    : null;
};

export const getReservationIntervalNormalization = (
  interval: ReservationIntervalInput
) =>
  Effect.runSync(
    normalizeReservationIntervalFields(interval, reservationTimeZone).pipe(
      Effect.map((normalized) => ({
        _tag: "Success" as const,
        interval: normalized,
      })),
      Effect.catch((issue) =>
        Effect.succeed({ _tag: "Failure" as const, issue })
      )
    )
  );

type NormalizedReservationInterval<T extends ReservationIntervalInput> = Omit<
  T,
  "startsAt" | "endsAt"
> &
  ReservationInterval;

export const normalizeReservationInterval = Effect.fn(
  "normalizeReservationInterval"
)(function* <T extends ReservationIntervalInput>(value: T) {
  const interval = yield* normalizeReservationIntervalFields(
    value,
    reservationTimeZone
  ).pipe(
    Effect.mapError(
      (cause) => new ReservationIntervalError({ message: cause.message, cause })
    )
  );
  const { startsAt: _startsAt, endsAt: _endsAt, ...rest } = value;

  return { ...rest, ...interval } as NormalizedReservationInterval<T>;
});

export const getReservationPragueDateRange = (
  reservation: ReservationInterval
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
