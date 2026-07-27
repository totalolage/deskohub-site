import { Effect } from "effect";
import { getCoworkCheckoutSummary } from "@/features/checkout/checkout-summary-cowork";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import {
  buildCoworkReservationQuote,
  type CoworkReservationQuote,
} from "@/features/checkout/reservation-quote-cowork";
import type { WorkspaceMoneyError } from "@/features/checkout/workspace-money";
import type {
  DiscountQuote,
  DiscountResolutionError,
} from "@/features/discounts";
import type {
  CoworkAdvertisedPriceDetails,
  CoworkAdvertisedPriceReservation,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
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

export type CoworkCheckoutPricingError =
  | WorkspaceMoneyError
  | DiscountResolutionError;

export type CoworkAdvertisementQuoteInput =
  ReservationAdvertisementQuoteInput<CoworkAdvertisedPriceReservation>;

export type CoworkAdvertisementAffirmationInput =
  ReservationAdvertisementAffirmationInput<
    CoworkAdvertisedPriceReservation,
    CoworkReservationQuote
  >;

export type CoworkCustomerQuoteInput =
  ReservationCustomerQuoteInput<NormalizedCoworkReservationOrder>;

export type CoworkPaymentPriceAffirmationInput =
  ReservationPaymentPriceAffirmationInput<
    NormalizedCoworkReservationOrder,
    CoworkReservationQuote
  >;

export type CoworkDiscountCodePriceInput = ReservationDiscountCodePriceInput<
  NormalizedCoworkReservationOrder,
  CoworkReservationQuote
>;

export type CoworkAdvertisementQuote = ReservationAdvertisementQuote<
  CoworkAdvertisedPriceReservation,
  CoworkReservationQuote
>;

export type CoworkAdvertisementAffirmation =
  ReservationAdvertisementAffirmation<
    CoworkAdvertisedPriceReservation,
    CoworkReservationQuote
  >;

export type CoworkCustomerQuote = ReservationCustomerQuote<
  NormalizedCoworkReservationOrder,
  CoworkReservationQuote
>;

export type CoworkPaymentPriceAffirmation = ReservationPaymentPriceAffirmation<
  NormalizedCoworkReservationOrder,
  CoworkReservationQuote
>;

export type CoworkDiscountCodePriceResult = ReservationDiscountCodePriceResult<
  NormalizedCoworkReservationOrder,
  CoworkReservationQuote
>;

const getCoworkPricingContext = Effect.fn(
  "CoworkCheckoutPricing.getPricingContext"
)((reservation: CoworkAdvertisedPriceDetails) => {
  const product = getWorkspaceProductByTier(reservation.entryTier);

  return Effect.succeed({
    reservation,
    discountInput: {
      product: { kind: "cowork" as const, tier: reservation.entryTier },
      discountableSubtotal: product.price,
      reservationDate: reservation.date,
    },
  });
});

type CoworkPricingContext = Effect.Success<
  ReturnType<typeof getCoworkPricingContext>
>;

const buildCoworkQuote = Effect.fn("CoworkCheckoutPricing.buildQuote")(
  (input: {
    readonly pricing: CoworkPricingContext;
    readonly discountQuote: DiscountQuote;
  }) =>
    buildCoworkReservationQuote(input.pricing.reservation, {
      discountQuote: input.discountQuote,
    })
);

export const coworkCheckoutPricing = reservationCheckoutPricing<
  CoworkAdvertisedPriceDetails,
  CoworkAdvertisedPriceReservation,
  NormalizedCoworkReservationOrder,
  CoworkPricingContext,
  CoworkReservationQuote,
  never,
  WorkspaceMoneyError
>({
  getPricingContext: getCoworkPricingContext,
  buildQuote: buildCoworkQuote,
  getCheckoutSummary: ({ quote, reservation }) =>
    getCoworkCheckoutSummary(reservation, quote),
});
