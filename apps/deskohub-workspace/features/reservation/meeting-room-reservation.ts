import { Effect, Schema } from "effect";
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
  reservationEndsAtEffectSchema,
  reservationStartsAtEffectSchema,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import {
  instantStringEffectSchema,
  localDateTimeEffectSchema,
} from "@/shared/utils/temporal";

export const meetingRoomReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationCustomerEffectFields,
  entryTier: Schema.Literal("meeting-room"),
  startsAt: reservationStartsAtEffectSchema,
  endsAt: reservationEndsAtEffectSchema,
});

export const normalizedMeetingRoomReservationOrderEffectSchema = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  message: Schema.optional(Schema.String),
  entryTier: Schema.Literal("meeting-room"),
  startsAt: instantStringEffectSchema,
  endsAt: instantStringEffectSchema,
});

export type MeetingRoomReservationOrderObject =
  typeof meetingRoomReservationOrderObjectEffectSchema.Type;
export type NormalizedMeetingRoomReservationOrder =
  typeof normalizedMeetingRoomReservationOrderEffectSchema.Type;

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
