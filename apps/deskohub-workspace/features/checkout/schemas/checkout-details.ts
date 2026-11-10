import { Match, Schema } from "effect";
import type { CoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { MeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { OfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import {
  coworkCheckoutDetailsSchema,
  getCoworkCheckoutDetails,
} from "@/features/checkout/schemas/checkout-details-cowork";
import {
  getMeetingRoomCheckoutDetails,
  meetingRoomCheckoutDetailsSchema,
} from "@/features/checkout/schemas/checkout-details-meeting-room";
import {
  getOfficeCheckoutDetails,
  officeCheckoutDetailsSchema,
} from "@/features/checkout/schemas/checkout-details-office";
import type { Locale } from "@/features/i18n";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import type { NormalizedMeetingRoomReservationOrder } from "@/features/reservation/meeting-room-reservation";
import type { NormalizedOfficeReservationOrder } from "@/features/reservation/office-reservation";

export const checkoutDetailsSchema = Schema.Union([
  coworkCheckoutDetailsSchema,
  meetingRoomCheckoutDetailsSchema,
  officeCheckoutDetailsSchema,
]).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetails = typeof checkoutDetailsSchema.Type;

/** A submitted reservation of any family with its quote. */
type PricedReservation =
  | {
      readonly kind: NormalizedCoworkReservationOrder["kind"];
      readonly reservation: NormalizedCoworkReservationOrder;
      readonly quote: CoworkReservationQuote;
    }
  | {
      readonly kind: NormalizedMeetingRoomReservationOrder["kind"];
      readonly reservation: NormalizedMeetingRoomReservationOrder;
      readonly quote: MeetingRoomReservationQuote;
    }
  | {
      readonly kind: NormalizedOfficeReservationOrder["kind"];
      readonly reservation: NormalizedOfficeReservationOrder;
      readonly quote: OfficeReservationQuote;
    };

/** The checkout details of a priced reservation, by its family. */
export const getCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly priced: PricedReservation;
  readonly legalEvidence: CheckoutDetails["legal"];
}): CheckoutDetails => {
  const { locale, legalEvidence } = input;
  return Match.value(input.priced).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ reservation, quote }) =>
        getCoworkCheckoutDetails({ locale, reservation, quote, legalEvidence }),
      "meeting-room": ({ reservation, quote }) =>
        getMeetingRoomCheckoutDetails({
          locale,
          reservation,
          quote,
          legalEvidence,
        }),
      office: ({ reservation, quote }) =>
        getOfficeCheckoutDetails({ locale, reservation, quote, legalEvidence }),
    })
  );
};
