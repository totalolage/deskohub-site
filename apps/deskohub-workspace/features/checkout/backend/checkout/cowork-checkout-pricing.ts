import { Effect } from "effect";
import {
  type CheckoutQuoteError,
  type CoworkReservationQuote,
  calculateCoworkAdvertisedPriceQuote,
  calculateCoworkReservationQuote,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { WorkspaceMoneyError } from "@/features/checkout/workspace-money";
import type { DiscountResolutionError } from "@/features/discounts";
import type {
  CoworkAdvertisedPriceDetails,
  CoworkAdvertisedPriceReservation,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import {
  getCoworkPriceSelection,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation-product";
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
)((reservation: CoworkAdvertisedPriceDetails) => {
  const order = getCoworkPriceSelection(reservation);
  const product = getWorkspaceProductByTier(order.entryTier);

  return Effect.succeed({
    order,
    monitorOption: getCoworkReservationProductMonitorOption(reservation),
    discountInput: {
      product: { kind: "cowork" as const, tier: order.entryTier },
      discountableSubtotal: product.price,
      reservationDate: reservation.date,
    },
  });
});

type CoworkPricingContext = Effect.Success<
  ReturnType<typeof getCoworkPricingContext>
>;

export const coworkCheckoutPricing = reservationCheckoutPricing<
  CoworkAdvertisedPriceDetails,
  CoworkAdvertisedPriceReservation,
  NormalizedCoworkReservationOrder,
  CoworkPricingContext,
  CoworkReservationQuote,
  CheckoutQuoteError,
  CheckoutQuoteError | WorkspaceMoneyError
>({
  getPricingContext: getCoworkPricingContext,
  buildQuote: ({ discountQuote, pricing }) =>
    pricing.order.entryTier === "profi" && !pricing.monitorOption
      ? calculateCoworkAdvertisedPriceQuote(pricing.order, { discountQuote })
      : calculateCoworkReservationQuote(
          {
            ...pricing.order,
            ...(pricing.monitorOption && {
              monitorOption: pricing.monitorOption,
            }),
          },
          { discountQuote }
        ),
  getCheckoutSummary: (quote) => quote.summary,
});
