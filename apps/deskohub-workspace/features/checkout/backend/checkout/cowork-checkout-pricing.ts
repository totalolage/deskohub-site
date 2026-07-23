import { Effect } from "effect";
import {
  type CheckoutQuoteError,
  type CoworkReservationQuote,
  calculateCoworkReservationQuote,
  normalizeCoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { WorkspaceMoneyError } from "@/features/checkout/workspace-money";
import type { DiscountResolutionError } from "@/features/discounts";
import type {
  CoworkAdvertisedPriceReservation,
  CoworkReservationDetails,
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
  | CheckoutQuoteError
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
)(function* (reservation: CoworkReservationDetails) {
  const order = yield* normalizeCoworkReservationQuoteOrder(reservation);
  const product = getWorkspaceProductByTier(order.entryTier);

  return {
    order,
    discountInput: {
      product: { kind: "cowork" as const, tier: order.entryTier },
      discountableSubtotal: product.price,
      reservationDate: reservation.date,
    },
  };
});

type CoworkPricingContext = Effect.Success<
  ReturnType<typeof getCoworkPricingContext>
>;

export const coworkCheckoutPricing = reservationCheckoutPricing<
  CoworkReservationDetails,
  CoworkAdvertisedPriceReservation,
  NormalizedCoworkReservationOrder,
  CoworkPricingContext,
  CoworkReservationQuote,
  CheckoutQuoteError,
  CheckoutQuoteError | WorkspaceMoneyError
>({
  getPricingContext: getCoworkPricingContext,
  buildQuote: ({ discountQuote, pricing }) =>
    calculateCoworkReservationQuote(pricing.order, { discountQuote }),
  getCheckoutSummary: (quote) => quote.summary,
});
