import { Schema } from "effect";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import { m } from "@/features/i18n";
import { reservationTimeZone } from "@/features/reservation/reservation-date";
import {
  reservationCustomerEmailEffectSchema,
  reservationCustomerMessageEffectSchema,
  reservationCustomerNameEffectSchema,
  reservationCustomerPhoneEffectSchema,
  reservationLegalConsentEffectSchema,
} from "@/features/reservation/schemas/reservation";
import { isFuturePlainDateTime } from "@/shared/utils";

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
