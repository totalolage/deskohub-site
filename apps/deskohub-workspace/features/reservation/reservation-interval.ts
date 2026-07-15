import {
  Data,
  Effect,
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
import { toPlainDateTime } from "@/features/reservation/reservation-interval-parser";
import {
  instantStringSchema,
  localDateTimeSchema,
  makeWholeHourInstantStringSchema,
  temporalInstantToPlainDate,
} from "@/shared/utils/temporal";

export type {
  ReservationInterval,
  ReservationIntervalInput,
} from "@/features/reservation/reservation-interval-domain";

export class ReservationIntervalError extends Data.TaggedError(
  "ReservationIntervalError"
)<{ readonly message: string; readonly cause?: unknown }> {}

export const reservationTimestampInputSchema = Schema.Union([
  localDateTimeSchema,
  instantStringSchema,
]);

const reservationIntervalInputFields = {
  startsAt: reservationTimestampInputSchema,
  endsAt: reservationTimestampInputSchema,
} as const;

export const reservationIntervalInputSchema = Schema.Struct(
  reservationIntervalInputFields
);
const decodeReservationIntervalInput = Schema.decodeUnknownSync(
  reservationIntervalInputSchema
);

export const reservationIntervalSchema = reservationIntervalInputSchema.pipe(
  Schema.decodeTo(
    Schema.Struct({
      startsAt: instantStringSchema,
      endsAt: instantStringSchema,
    }),
    {
      decode: SchemaGetter.transformOrFail((input) =>
        normalizeReservationIntervalFields(input, reservationTimeZone).pipe(
          Effect.mapError((issue) => toSchemaIssue(input, issue))
        )
      ),
      encode: SchemaGetter.transform(decodeReservationIntervalInput),
    }
  )
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
) => m.reservationMeetingRoomDurationHours({ count: duration / 60 });

export const getMeetingRoomDurationValidationMessage = () =>
  m.reservationValidationMeetingRoomDuration({
    durations: workspaceMeetingRoomDurationOptions
      .map(getMeetingRoomDurationMessage)
      .join(", "),
  });

export const wholeHourReservationInstantSchema =
  makeWholeHourInstantStringSchema(reservationTimeZone);

export const meetingRoomReservationDurationMinutesSchema = Schema.Number.check(
  Schema.makeFilter(isWorkspaceMeetingRoomDuration, {
    message: getMeetingRoomDurationValidationMessage(),
  })
);

const isWholeHourReservationInstant = Schema.is(
  wholeHourReservationInstantSchema
);
const isMeetingRoomReservationDuration = Schema.is(
  meetingRoomReservationDurationMinutesSchema
);

export const coworkReservationIntervalSchema = reservationIntervalSchema.check(
  Schema.makeFilter(isSingleDayReservationInterval, {
    message: "Cowork reservations must use the full-day duration.",
  })
);

export const meetingRoomReservationIntervalSchema =
  reservationIntervalSchema.check(
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
