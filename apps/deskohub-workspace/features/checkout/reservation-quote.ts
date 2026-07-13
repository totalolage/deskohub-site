import { Effect, Match } from "effect";
import { getCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";

export { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";

import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import type { ReservationQuoteItem } from "@/features/checkout/reservation-quote-item";
import { getMeetingRoomReservationQuote } from "@/features/checkout/reservation-quote-meeting-room";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import type { AppliedDiscount, DiscountQuote } from "@/features/discounts";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";

export type { ReservationQuoteItem } from "@/features/checkout/reservation-quote-item";

export type ReservationQuote = {
  readonly items: readonly ReservationQuoteItem[];
  readonly fingerprint: string;
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
    readonly undiscountedPrice: WorkspaceMoney;
    readonly discounts: readonly AppliedDiscount[];
  };
};

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
          getMeetingRoomReservationQuote(
            meetingRoomReservation,
            options.currencyOverride
          ),
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
