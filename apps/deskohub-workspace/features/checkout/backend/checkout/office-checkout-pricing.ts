import { Effect } from "effect";
import { getOfficeCheckoutSummary } from "@/features/checkout/checkout-summary-office";
import {
  buildOfficeReservationQuote,
  getOfficeReservationQuote,
  type OfficeReservationQuote,
} from "@/features/checkout/reservation-quote-office";
import type {
  DiscountQuote,
  DiscountResolutionError,
} from "@/features/discounts";
import type {
  NormalizedOfficeReservationOrder,
  OfficeAdvertisedPriceReservation,
  OfficeReservationPricingInput,
} from "@/features/reservation/office-reservation";
import {
  type ReservationAdvertisementAffirmation,
  type ReservationAdvertisementAffirmationInput,
  type ReservationAdvertisementQuote,
  type ReservationAdvertisementQuoteInput,
  type ReservationCustomerQuote,
  type ReservationCustomerQuoteInput,
  type ReservationDiscountCodePriceInput,
  type ReservationDiscountCodePriceResult,
  type ReservationPaymentPriceAffirmation,
  type ReservationPaymentPriceAffirmationInput,
  reservationCheckoutPricing,
} from "./reservation-checkout-pricing";

export type OfficeCheckoutPricingError = DiscountResolutionError;
export type OfficeAdvertisementQuoteInput =
  ReservationAdvertisementQuoteInput<OfficeAdvertisedPriceReservation>;
export type OfficeAdvertisementAffirmationInput =
  ReservationAdvertisementAffirmationInput<
    OfficeAdvertisedPriceReservation,
    OfficeReservationQuote
  >;
export type OfficeCustomerQuoteInput =
  ReservationCustomerQuoteInput<NormalizedOfficeReservationOrder>;
export type OfficePaymentPriceAffirmationInput =
  ReservationPaymentPriceAffirmationInput<
    NormalizedOfficeReservationOrder,
    OfficeReservationQuote
  >;
export type OfficeDiscountCodePriceInput = ReservationDiscountCodePriceInput<
  NormalizedOfficeReservationOrder,
  OfficeReservationQuote
>;
export type OfficeAdvertisementQuote = ReservationAdvertisementQuote<
  OfficeAdvertisedPriceReservation,
  OfficeReservationQuote
>;
export type OfficeAdvertisementAffirmation =
  ReservationAdvertisementAffirmation<
    OfficeAdvertisedPriceReservation,
    OfficeReservationQuote
  >;
export type OfficeCustomerQuote = ReservationCustomerQuote<
  NormalizedOfficeReservationOrder,
  OfficeReservationQuote
>;
export type OfficePaymentPriceAffirmation = ReservationPaymentPriceAffirmation<
  NormalizedOfficeReservationOrder,
  OfficeReservationQuote
>;
export type OfficeDiscountCodePriceResult = ReservationDiscountCodePriceResult<
  NormalizedOfficeReservationOrder,
  OfficeReservationQuote
>;

const getOfficePricingContext = Effect.fn(
  "OfficeCheckoutPricing.getPricingContext"
)(function* (reservation: OfficeReservationPricingInput) {
  const undiscountedQuote = yield* getOfficeReservationQuote(reservation);
  const [productItem] = undiscountedQuote.items;

  return {
    reservation,
    discountInput: {
      product: { kind: "office" as const },
      discountableSubtotal: productItem.amount,
      reservationDate: reservation.startsOn,
    },
  };
});

type OfficePricingContext = Effect.Success<
  ReturnType<typeof getOfficePricingContext>
>;

const buildOfficeQuote = Effect.fn("OfficeCheckoutPricing.buildQuote")(
  (input: {
    readonly pricing: OfficePricingContext;
    readonly discountQuote: DiscountQuote;
  }) =>
    buildOfficeReservationQuote(input.pricing.reservation, {
      discountQuote: input.discountQuote,
    })
);

export const officeCheckoutPricing = reservationCheckoutPricing<
  OfficeReservationPricingInput,
  OfficeAdvertisedPriceReservation,
  NormalizedOfficeReservationOrder,
  OfficePricingContext,
  OfficeReservationQuote,
  never,
  never
>({
  getPricingContext: getOfficePricingContext,
  buildQuote: buildOfficeQuote,
  getCheckoutSummary: ({ quote }) => getOfficeCheckoutSummary(quote),
});
