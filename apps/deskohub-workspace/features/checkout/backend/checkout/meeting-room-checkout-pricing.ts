import { Effect } from "effect";
import { getMeetingRoomCheckoutSummary } from "@/features/checkout/checkout-summary-meeting-room";
import type { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import {
  getMeetingRoomReservationQuote,
  type MeetingRoomReservationQuote,
} from "@/features/checkout/reservation-quote-meeting-room";
import type {
  DiscountQuote,
  DiscountResolutionError,
} from "@/features/discounts";
import type {
  MeetingRoomAdvertisedPriceReservation,
  MeetingRoomReservationPricingInput,
  NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import {
  type ReservationAdvertisementAffirmation,
  type ReservationAdvertisementAffirmationInput,
  type ReservationAdvertisementQuote,
  type ReservationAdvertisementQuoteInput,
  type ReservationCustomerQuoteInput,
  type ReservationDiscountCodePriceInput,
  type ReservationDiscountCodePriceResult,
  type ReservationPaymentPriceAffirmation,
  type ReservationPaymentPriceAffirmationInput,
  type ReservationPreparedCustomerQuote,
  reservationCheckoutPricing,
} from "./reservation-checkout-pricing";

export type MeetingRoomCheckoutPricingError =
  | ReservationQuoteError
  | DiscountResolutionError;

export type MeetingRoomAdvertisementQuoteInput =
  ReservationAdvertisementQuoteInput<MeetingRoomAdvertisedPriceReservation>;

export type MeetingRoomAdvertisementAffirmationInput =
  ReservationAdvertisementAffirmationInput<
    MeetingRoomAdvertisedPriceReservation,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomCustomerQuoteInput =
  ReservationCustomerQuoteInput<NormalizedMeetingRoomReservationOrder>;

export type MeetingRoomPaymentPriceAffirmationInput =
  ReservationPaymentPriceAffirmationInput<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomDiscountCodePriceInput =
  ReservationDiscountCodePriceInput<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomAdvertisementQuote = ReservationAdvertisementQuote<
  MeetingRoomAdvertisedPriceReservation,
  MeetingRoomReservationQuote
>;

export type MeetingRoomAdvertisementAffirmation =
  ReservationAdvertisementAffirmation<
    MeetingRoomAdvertisedPriceReservation,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomCustomerQuote = ReservationPreparedCustomerQuote<
  NormalizedMeetingRoomReservationOrder,
  MeetingRoomReservationQuote
>;

export type MeetingRoomPaymentPriceAffirmation =
  ReservationPaymentPriceAffirmation<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomDiscountCodePriceResult =
  ReservationDiscountCodePriceResult<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

const getMeetingRoomPricingContext = Effect.fn(
  "MeetingRoomCheckoutPricing.getPricingContext"
)(function* (reservation: MeetingRoomReservationPricingInput) {
  const undiscountedQuote = yield* getMeetingRoomReservationQuote(reservation);
  const [productItem] = undiscountedQuote.items;

  return {
    reservation,
    discountInput: {
      product: {
        kind: "meeting-room" as const,
        duration: productItem.duration,
      },
      discountableSubtotal: productItem.amount,
      reservationDate: reservation.reservationDate,
    },
  };
});

type MeetingRoomPricingContext = Effect.Success<
  ReturnType<typeof getMeetingRoomPricingContext>
>;

const buildMeetingRoomQuote = Effect.fn(
  "MeetingRoomCheckoutPricing.buildQuote"
)(function* (input: {
  readonly pricing: MeetingRoomPricingContext;
  readonly discountQuote: DiscountQuote;
}) {
  const quoteWithoutFingerprint = yield* getMeetingRoomReservationQuote(
    input.pricing.reservation,
    { discountQuote: input.discountQuote }
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      input.pricing.reservation,
      quoteWithoutFingerprint
    ),
  };
});

export const meetingRoomCheckoutPricing = reservationCheckoutPricing<
  MeetingRoomReservationPricingInput,
  MeetingRoomAdvertisedPriceReservation,
  NormalizedMeetingRoomReservationOrder,
  MeetingRoomPricingContext,
  MeetingRoomReservationQuote,
  ReservationQuoteError,
  ReservationQuoteError
>({
  getPricingContext: getMeetingRoomPricingContext,
  buildQuote: buildMeetingRoomQuote,
  getCheckoutSummary: ({ quote }) => getMeetingRoomCheckoutSummary(quote),
});
