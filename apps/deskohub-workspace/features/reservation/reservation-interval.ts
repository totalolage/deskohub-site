import {
  Data,
  Effect,
  Match,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import {
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
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

export const isSingleDayReservationInterval = (
  interval: ReservationInterval
) => {
  const start = toPlainDateTime(interval.startsAt, reservationTimeZone);
  const end = toPlainDateTime(interval.endsAt, reservationTimeZone);

  return (
    isMidnight(start) &&
    isMidnight(end) &&
    end.toPlainDate().equals(start.toPlainDate().add({ days: 1 }))
  );
};

const getMeetingRoomDurationMessage = (
  duration: WorkspaceMeetingRoomDurationMinutes
) =>
  Match.value(duration).pipe(
    Match.when(60, () => m.reservationMeetingRoomDurationOneHour()),
    Match.when(240, () => m.reservationMeetingRoomDurationFourHours()),
    Match.when(1440, () => m.reservationMeetingRoomDurationTwentyFourHours()),
    Match.exhaustive
  );

export const getMeetingRoomDurationValidationMessage = () =>
  m.reservationValidationMeetingRoomDuration({
    durations: workspaceMeetingRoomDurationOptions
      .map(getMeetingRoomDurationMessage)
      .join(", "),
  });

export const wholeHourReservationInstantEffectSchema =
  makeWholeHourInstantStringEffectSchema(reservationTimeZone);

export const meetingRoomReservationDurationMinutesEffectSchema =
  Schema.Number.check(
    Schema.makeFilter(isWorkspaceMeetingRoomDuration, {
      message: getMeetingRoomDurationValidationMessage(),
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
    Schema.makeFilter(isSingleDayReservationInterval, {
      message: "Cowork reservations must use the full-day duration.",
    })
  );

export const meetingRoomReservationIntervalEffectSchema =
  normalizedReservationIntervalEffectSchema.check(
    Schema.makeFilter(
      (interval) =>
        isMeetingRoomReservationDuration(getDurationMinutes(interval)),
      {
        message: getMeetingRoomDurationValidationMessage(),
      }
    ),
    Schema.makeFilter(
      (interval) => isWholeHourReservationInstant(interval.startsAt),
      {
        message: m.reservationValidationMeetingRoomStartWholeHour(),
      }
    )
  );

export const getReservationIntervalValidationIssue = (
  interval: ReservationIntervalInput
) =>
  getReservationIntervalNormalization(interval).pipe(
    Effect.as(null),
    Effect.catch((issue) =>
      Effect.succeed({
        path: issue.path,
        message: issue.message,
      })
    )
  );

export const getReservationIntervalNormalization = (
  interval: ReservationIntervalInput
) => normalizeReservationIntervalFields(interval, reservationTimeZone);

export const normalizeReservationInterval = Effect.fn(
  "normalizeReservationInterval"
)(function* (value: ReservationIntervalInput) {
  return yield* normalizeReservationIntervalFields(
    value,
    reservationTimeZone
  ).pipe(
    Effect.mapError(
      (cause) => new ReservationIntervalError({ message: cause.message, cause })
    )
  );
});

export const getReservationDateRange = (
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
