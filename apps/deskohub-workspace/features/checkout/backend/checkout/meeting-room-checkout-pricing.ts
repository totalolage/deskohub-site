import { Effect } from "effect";
import type { ReservationQuoteError } from "@/features/checkout/reservation-quote-error";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import {
  getMeetingRoomReservationQuote,
  type MeetingRoomReservationQuote,
} from "@/features/checkout/reservation-quote-meeting-room";
import type {
  DiscountCalculationError,
  DiscountQuote,
} from "@/features/discounts";
import type {
  MeetingRoomAdvertisedPriceReservation,
  MeetingRoomReservationDetails,
  NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDate } from "@/features/reservation/meeting-room-reservation-time";
import {
  type ReservationAdvertisementAffirmation,
  type ReservationAdvertisementAffirmationInput,
  type ReservationAdvertisementQuote,
  type ReservationAdvertisementQuoteInput,
  type ReservationCustomerQuote,
  type ReservationCustomerQuoteInput,
  type ReservationPaymentPriceAffirmation,
  type ReservationPaymentPriceAffirmationInput,
  reservationCheckoutPricing,
} from "./reservation-checkout-pricing";

export type MeetingRoomCheckoutPricingError =
  | ReservationQuoteError
  | DiscountCalculationError;

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

export type MeetingRoomAdvertisementQuote = ReservationAdvertisementQuote<
  MeetingRoomAdvertisedPriceReservation,
  MeetingRoomReservationQuote
>;

export type MeetingRoomAdvertisementAffirmation =
  ReservationAdvertisementAffirmation<
    MeetingRoomAdvertisedPriceReservation,
    MeetingRoomReservationQuote
  >;

export type MeetingRoomCustomerQuote = ReservationCustomerQuote<
  NormalizedMeetingRoomReservationOrder,
  MeetingRoomReservationQuote
>;

export type MeetingRoomPaymentPriceAffirmation =
  ReservationPaymentPriceAffirmation<
    NormalizedMeetingRoomReservationOrder,
    MeetingRoomReservationQuote
  >;

const getMeetingRoomPricingContext = Effect.fn(
  "MeetingRoomCheckoutPricing.getPricingContext"
)(function* (reservation: MeetingRoomReservationDetails) {
  const undiscountedQuote = yield* getMeetingRoomReservationQuote(reservation);
  const [productItem] = undiscountedQuote.items;

  return {
    reservation,
    discountInput: {
      product: {
        kind: "meeting-room" as const,
        durationMinutes: productItem.durationMinutes,
      },
      discountableSubtotal: productItem.amount,
      reservationDate: getMeetingRoomReservationDate(reservation),
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
  MeetingRoomReservationDetails,
  MeetingRoomAdvertisedPriceReservation,
  NormalizedMeetingRoomReservationOrder,
  MeetingRoomPricingContext,
  MeetingRoomReservationQuote,
  ReservationQuoteError,
  ReservationQuoteError
>({
  getPricingContext: getMeetingRoomPricingContext,
  buildQuote: buildMeetingRoomQuote,
});
