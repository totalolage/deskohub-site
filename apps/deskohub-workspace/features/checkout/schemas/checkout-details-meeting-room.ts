import { Schema } from "effect";
import {
  type MeetingRoomReservationQuote,
  meetingRoomReservationQuoteItemSchema,
} from "@/features/checkout/reservation-quote-meeting-room";
import { makeCheckoutDetailsSchema } from "@/features/checkout/schemas/checkout-details-base";
import type { Locale } from "@/features/i18n";
import {
  getMeetingRoomReservationDetails,
  meetingRoomReservationDetailsSchema,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";

export const meetingRoomCheckoutDetailsJsonSchema = makeCheckoutDetailsSchema({
  reservation: meetingRoomReservationDetailsSchema,
  paymentFields: {
    items: Schema.Array(meetingRoomReservationQuoteItemSchema),
  },
});

export type MeetingRoomCheckoutDetailsJson =
  typeof meetingRoomCheckoutDetailsJsonSchema.Type;

export const getMeetingRoomCheckoutDetails = (input: {
  readonly locale: Locale;
  readonly reservation: NormalizedMeetingRoomReservationOrder;
  readonly quote: MeetingRoomReservationQuote;
  readonly legalEvidence: MeetingRoomCheckoutDetailsJson["legal"];
}): MeetingRoomCheckoutDetailsJson => ({
  locale: input.locale,
  reservation: getMeetingRoomReservationDetails(input.reservation),
  payment: {
    expectedPrice: input.quote.payment.expectedPrice,
    undiscountedPrice: input.quote.payment.undiscountedPrice,
    discounts: [...input.quote.payment.discounts],
    items: input.quote.items,
  },
  legal: input.legalEvidence,
});
