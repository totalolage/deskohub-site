import { Effect, Schema } from "effect";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationLegalConsentEffectSchema } from "@/features/reservation/reservation-consent";
import {
  reservationCustomerEffectFields,
  reservationCustomerEmailEffectSchema,
  reservationCustomerMessageEffectSchema,
  reservationCustomerNameEffectSchema,
  reservationCustomerPhoneEffectSchema,
} from "@/features/reservation/reservation-contact";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  getReservationDurationMinutes,
  getReservationIntervalNormalization,
  getReservationPragueDateRange,
  meetingRoomReservationDurationMinutesEffectSchema,
  wholeHourReservationInstantEffectSchema,
} from "@/features/reservation/reservation-interval";
import { isFuturePlainDateTime } from "@/shared/utils";
import { instantStringEffectSchema } from "@/shared/utils/temporal";

export const meetingRoomReservationOrderObjectEffectSchema = Schema.Struct({
  ...reservationCustomerEffectFields,
  entryTier: Schema.Literal("meeting-room"),
  startsAt: Schema.String,
  endsAt: Schema.String,
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

export const getMeetingRoomReservationIssues = (
  reservation: MeetingRoomReservationOrderObject
): readonly Schema.FilterIssue[] => {
  const normalization = getReservationIntervalNormalization(reservation);
  if (normalization._tag === "Failure") {
    return [
      {
        path: [normalization.issue.path],
        issue: normalization.issue.message,
      },
    ];
  }

  const interval = normalization.interval;
  if (!Schema.is(wholeHourReservationInstantEffectSchema)(interval.startsAt)) {
    return [
      {
        path: ["startsAt"],
        issue: "Meeting room reservations must start on a whole hour.",
      },
    ];
  }

  if (
    !Schema.is(meetingRoomReservationDurationMinutesEffectSchema)(
      getReservationDurationMinutes(interval)
    )
  ) {
    return [
      {
        path: ["endsAt"],
        issue: "Meeting room duration must be 1 hour, 4 hours, or 24 hours.",
      },
    ];
  }

  const range = Effect.runSync(getReservationPragueDateRange(interval));
  if (range.startMs < Date.now()) {
    return [
      {
        path: ["startsAt"],
        issue: m.reservationValidationDatePast(),
      },
    ];
  }

  return [];
};

const meetingRoomStartDateTimeEffectSchema = Schema.String.check(
  Schema.isNonEmpty({
    message: m.reservationValidationMeetingRoomStartRequired(),
  }),
  Schema.makeFilter((value) => value.endsWith(":00"), {
    message: m.reservationValidationMeetingRoomStartWholeHour(),
  }),
  Schema.makeFilter(
    (value) =>
      value === "" ||
      isFuturePlainDateTime({
        dateTime: Temporal.PlainDateTime.from(value),
        timeZone: reservationTimeZone,
      }),
    { message: m.reservationValidationDatePast() }
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
});

export type MeetingRoomReservationInput =
  typeof meetingRoomReservationEffectSchema.Encoded;
export type MeetingRoomReservationData =
  typeof meetingRoomReservationEffectSchema.Type;
