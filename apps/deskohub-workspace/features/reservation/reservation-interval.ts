import {
  Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import {
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import type {
  ReservationInterval,
  ReservationIntervalInput,
} from "@/features/reservation/reservation-interval-domain";
import { isSingleDayReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { normalizeReservationIntervalFields } from "@/features/reservation/reservation-interval-normalization";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
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
export { isSingleDayReservationInterval };

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
        normalizeReservationIntervalFields(
          input,
          workspaceSiteConstants.location.timeZone
        ).pipe(Effect.mapError((issue) => toSchemaIssue(input, issue)))
      ),
      encode: SchemaGetter.transform(decodeReservationIntervalInput),
    }
  )
);

const getMeetingRoomDurationMessage = (
  duration: MeetingRoomReservationDuration
) => {
  if (isMeetingRoomWholeDayReservationDuration(duration)) {
    return m.reservationMeetingRoomDurationWholeDay();
  }

  return m.reservationMeetingRoomDurationHours({ count: duration.amount });
};

export const getMeetingRoomDurationValidationMessage = () =>
  m.reservationValidationMeetingRoomDuration({
    durations: workspaceMeetingRoomCatalog
      .map(({ duration }) => getMeetingRoomDurationMessage(duration))
      .join(", "),
  });

export const wholeHourReservationInstantSchema =
  makeWholeHourInstantStringSchema(workspaceSiteConstants.location.timeZone);

export const coworkReservationIntervalSchema = reservationIntervalSchema.check(
  Schema.makeFilter(isSingleDayReservationInterval, {
    message: "Cowork reservations must use the full-day duration.",
  })
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
) =>
  normalizeReservationIntervalFields(
    interval,
    workspaceSiteConstants.location.timeZone
  );

export const normalizeReservationInterval = Effect.fn(
  "normalizeReservationInterval"
)(function* (value: ReservationIntervalInput) {
  return yield* normalizeReservationIntervalFields(
    value,
    workspaceSiteConstants.location.timeZone
  ).pipe(
    Effect.mapError(
      (cause) => new ReservationIntervalError({ message: cause.message, cause })
    )
  );
});

export const hasReservationIntervalEnded = (
  interval: Pick<ReservationInterval, "endsAt">,
  now = Temporal.Now.instant()
) => Temporal.Instant.compare(Temporal.Instant.from(interval.endsAt), now) < 0;

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
