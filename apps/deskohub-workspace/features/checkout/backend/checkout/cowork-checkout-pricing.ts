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
  CoworkReservationDetails,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
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

export type CoworkCustomerQuote = ReservationPreparedCustomerQuote<
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
)((reservation: CoworkPricingSelection) => {
  const product = getWorkspaceProductByTier(reservation.entryTier);

  return Effect.succeed({
    reservation,
    discountInput: {
      product: { kind: "cowork" as const, tier: reservation.entryTier },
      discountableSubtotal: product.price,
      lastServiceDate: reservation.date,
    },
  });
});

/**
 * PII-free cowork selection that pricing accepts: advertised-price inputs or
 * the reservation domain's details projection. A full order satisfies it
 * structurally through `CoworkReservationDetails`, so the pricing selection
 * concept never names customer identity.
 */
type CoworkPricingSelection =
  | CoworkAdvertisedPriceDetails
  | CoworkReservationDetails;

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
  CoworkPricingSelection,
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
