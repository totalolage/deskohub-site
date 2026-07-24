import { Effect, Match, Schema } from "effect";
import { getCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";

export { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";

import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { reservationQuoteItemSchema } from "@/features/checkout/reservation-quote-item";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import type { DiscountQuote } from "@/features/discounts/contracts";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export type { ReservationQuoteItem } from "@/features/checkout/reservation-quote-item";

export const reservationQuoteSchema = makeReservationQuoteSchema(
  Schema.Array(reservationQuoteItemSchema)
).annotate({
  identifier: "ReservationQuote",
  description: "Authoritative reservation quote snapshot.",
});

export type ReservationQuote = typeof reservationQuoteSchema.Type;

export const buildReservationQuote = Effect.fn("buildReservationQuote")(
  function* (
    reservation: ReservationOrderData,
    options: {
      readonly discountQuote?: DiscountQuote;
    } = {}
  ) {
    const quoteWithoutFingerprint = yield* Match.value(reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: (coworkReservation) =>
          getCoworkReservationQuote(coworkReservation, {
            discountQuote: options.discountQuote,
          }),
        "meeting-room": (meetingRoomReservation) =>
          getMeetingRoomReservationQuote(meetingRoomReservation, {
            discountQuote: options.discountQuote,
          }),
      })
    );
    const fingerprint = getReservationQuoteFingerprint(
      reservation,
      quoteWithoutFingerprint
    );

    return {
      ...quoteWithoutFingerprint,
      fingerprint,
    };
  }
);
