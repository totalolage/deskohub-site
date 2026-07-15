import {
  type Data,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { reservationLegalConsentEffectSchema } from "@/features/reservation/reservation-consent";
import {
  reservationCustomerEffectFields,
  reservationCustomerEmailEffectSchema,
  reservationCustomerMessageEffectSchema,
  reservationCustomerNameEffectSchema,
  reservationCustomerPhoneEffectSchema,
} from "@/features/reservation/reservation-contact";
import {
  getMeetingRoomDurationValidationMessage,
  getReservationIntervalNormalization,
  meetingRoomReservationDurationMinutesEffectSchema,
  reservationTimestampInputEffectSchema,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import {
  instantStringEffectSchema,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";

export const meetingRoomReservationOrderObjectEffectSchema =
  Schema.TaggedStruct("meeting-room", {
    ...reservationCustomerEffectFields,
    startsAt: reservationTimestampInputEffectSchema,
    endsAt: reservationTimestampInputEffectSchema,
  });

export const normalizedMeetingRoomReservationOrderEffectSchema =
  Schema.TaggedStruct("meeting-room", {
    name: Schema.String,
    email: Schema.String,
    phone: Schema.String,
    message: Schema.optional(Schema.String),
    startsAt: instantStringEffectSchema,
    endsAt: instantStringEffectSchema,
  });

export type MeetingRoomReservationOrderObject =
  typeof meetingRoomReservationOrderObjectEffectSchema.Type;
export type NormalizedMeetingRoomReservationOrder =
  typeof normalizedMeetingRoomReservationOrderEffectSchema.Type;

export type MeetingRoomReservationProductInput = Data.TaggedEnum<{
  "meeting-room": Record<never, never>;
}>;

export const getMeetingRoomReservationProductCoffee = (
  _reservation: MeetingRoomReservationProductInput
) => false;

export const getMeetingRoomReservationProductMonitorOption = (
  _reservation: MeetingRoomReservationProductInput
) => undefined;

export const getMeetingRoomReservationIssues = Effect.fn(
  "getMeetingRoomReservationIssues"
)(function* (reservation: MeetingRoomReservationOrderObject) {
  const interval = yield* getReservationIntervalNormalization(reservation);
  if (!Schema.is(wholeHourReservationInstantEffectSchema)(interval.startsAt)) {
    return [
      {
        path: ["startsAt"],
        issue: m.reservationValidationMeetingRoomStartWholeHour(),
      },
    ];
  }

  if (
    !Schema.is(meetingRoomReservationDurationMinutesEffectSchema)(
      getDurationMinutes(interval)
    )
  ) {
    return [
      {
        path: ["endsAt"],
        issue: getMeetingRoomDurationValidationMessage(),
      },
    ];
  }

  if (
    Temporal.Instant.compare(
      Temporal.Instant.from(interval.endsAt),
      Temporal.Now.instant()
    ) < 0
  ) {
    return [
      {
        path: ["endsAt"],
        issue: m.reservationValidationMeetingRoomEnded(),
      },
    ];
  }

  return [];
});

const toMeetingRoomReservationSchemaIssue = (
  input: MeetingRoomReservationOrderObject,
  path: readonly PropertyKey[],
  message: string
) =>
  new SchemaIssue.Pointer(
    path,
    new SchemaIssue.InvalidValue(Option.some(input), { message })
  );

const validateMeetingRoomReservationOrder = Effect.fn(
  "validateMeetingRoomReservationOrder"
)(function* (reservation: MeetingRoomReservationOrderObject) {
  const issues = yield* getMeetingRoomReservationIssues(reservation).pipe(
    Effect.mapError((error) =>
      toMeetingRoomReservationSchemaIssue(
        reservation,
        [error.path],
        error.message
      )
    )
  );
  const issue = issues[0];

  if (issue) {
    return yield* Effect.fail(
      toMeetingRoomReservationSchemaIssue(reservation, issue.path, issue.issue)
    );
  }
});

export const normalizeMeetingRoomReservationOrder = (
  reservation: MeetingRoomReservationOrderObject
) =>
  getReservationIntervalNormalization(reservation).pipe(
    Effect.map((interval) =>
      normalizedMeetingRoomReservationOrderEffectSchema.make({
        name: reservation.name,
        email: reservation.email,
        phone: reservation.phone,
        ...(reservation.message !== undefined && {
          message: reservation.message,
        }),
        ...interval,
      })
    )
  );

const decodeMeetingRoomReservationOrder = Effect.fn(
  "decodeMeetingRoomReservationOrder"
)(function* (reservation: MeetingRoomReservationOrderObject) {
  yield* validateMeetingRoomReservationOrder(reservation);
  return yield* normalizeMeetingRoomReservationOrder(reservation).pipe(
    Effect.mapError((error) =>
      toMeetingRoomReservationSchemaIssue(
        reservation,
        [error.path],
        error.message
      )
    )
  );
});

const decodeMeetingRoomReservationOrderObject = Schema.decodeUnknownSync(
  meetingRoomReservationOrderObjectEffectSchema
);

export const meetingRoomReservationOrderEffectSchema =
  meetingRoomReservationOrderObjectEffectSchema.pipe(
    Schema.decodeTo(normalizedMeetingRoomReservationOrderEffectSchema, {
      decode: SchemaGetter.transformOrFail(decodeMeetingRoomReservationOrder),
      encode: SchemaGetter.transform(decodeMeetingRoomReservationOrderObject),
    })
  );

const meetingRoomStartDateTimeEffectSchema = Schema.String.check(
  Schema.isNonEmpty({
    message: m.reservationValidationMeetingRoomStartRequired(),
  }),
  Schema.makeFilter((value) => value.endsWith(":00"), {
    message: m.reservationValidationMeetingRoomStartWholeHour(),
  }),
  Schema.makeFilter(
    (value) => value === "" || Schema.is(localDateTimeEffectSchema)(value),
    { message: m.reservationValidationMeetingRoomStartRequired() }
  )
);

export const meetingRoomReservationEffectSchema = Schema.Struct({
  startDateTime: meetingRoomStartDateTimeEffectSchema,
  durationMinutes: Schema.Literals(workspaceMeetingRoomDurationOptions),
  name: reservationCustomerNameEffectSchema,
  email: reservationCustomerEmailEffectSchema,
  phone: reservationCustomerPhoneEffectSchema,
  message: Schema.optional(reservationCustomerMessageEffectSchema),
  legalConsent: reservationLegalConsentEffectSchema,
}).check(
  Schema.makeFilter((reservation) => {
    const interval = getMeetingRoomReservationInterval(
      reservation.startDateTime,
      reservation.durationMinutes
    );

    return (
      interval === null ||
      Temporal.Instant.compare(
        Temporal.Instant.from(interval.endsAt),
        Temporal.Now.instant()
      ) >= 0 || {
        path: ["startDateTime"],
        issue: m.reservationValidationMeetingRoomEnded(),
      }
    );
  })
);

export type MeetingRoomReservationInput =
  typeof meetingRoomReservationEffectSchema.Encoded;
export type MeetingRoomReservationData =
  typeof meetingRoomReservationEffectSchema.Type;
