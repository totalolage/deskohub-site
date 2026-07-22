import { Effect, Match, Schema } from "effect";
import { getCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";

export { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";

import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { reservationQuoteItemSchema } from "@/features/checkout/reservation-quote-item";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import {
  appliedDiscountCodec,
  type DiscountQuote,
} from "@/features/discounts/contracts";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export type { ReservationQuoteItem } from "@/features/checkout/reservation-quote-item";

export const reservationQuoteSchema = Schema.Struct({
  items: Schema.Array(reservationQuoteItemSchema),
  fingerprint: Schema.NonEmptyString,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
  }),
}).annotate({
  identifier: "ReservationQuote",
  description: "Authoritative reservation quote snapshot.",
});

export type ReservationQuote = typeof reservationQuoteSchema.Type;

export const buildReservationQuote = Effect.fn("buildReservationQuote")(
  function* (
    reservation: ReservationOrderData,
    options: {
      readonly discountQuote?: DiscountQuote;
      readonly currencyOverride?: string;
    } = {}
  ) {
    const quoteWithoutFingerprint = yield* Match.value(reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: (coworkReservation) =>
          getCoworkReservationQuote(coworkReservation, {
            discountQuote: options.discountQuote,
            currencyOverride: options.currencyOverride,
          }),
        "meeting-room": (meetingRoomReservation) =>
          getMeetingRoomReservationQuote(meetingRoomReservation, {
            discountQuote: options.discountQuote,
            currencyOverride: options.currencyOverride,
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
