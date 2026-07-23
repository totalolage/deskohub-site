import { Effect } from "effect";
import {
  type CheckoutQuoteError,
  type CoworkReservationQuote,
  calculateCoworkReservationQuote,
  normalizeCoworkReservationQuoteOrder,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { WorkspaceMoneyError } from "@/features/checkout/workspace-money";
import {
  type AffirmedDiscountAdvertisementQuote,
  type CanonicalDiscountCode,
  type DiscountCalculationError,
  type DiscountCommitment,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type {
  CoworkAdvertisedPriceReservation,
  CoworkReservationDetails,
  NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

export type CoworkCheckoutPricingError =
  | CheckoutQuoteError
  | WorkspaceMoneyError
  | DiscountCalculationError;

export type CoworkAdvertisementQuoteInput = {
  readonly reservation: CoworkAdvertisedPriceReservation;
  readonly locale: Locale;
};

export type CoworkAdvertisementAffirmationInput =
  CoworkAdvertisementQuoteInput & {
    readonly advertisedQuote: CoworkReservationQuote;
  };

export type CoworkCustomerQuoteInput = {
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
};

export type CoworkPaymentPriceAffirmationInput = {
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly quote: CoworkReservationQuote;
  readonly submittedCode?: CanonicalDiscountCode;
};

export type CoworkAdvertisementQuote = {
  readonly kind: "cowork";
  readonly reservation: CoworkAdvertisedPriceReservation;
  readonly quote: CoworkReservationQuote;
};

export type CoworkAdvertisementAffirmation = CoworkAdvertisementQuote & {
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
};

export type CoworkCustomerQuote = {
  readonly kind: "cowork";
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly quote: CoworkReservationQuote;
};

export type CoworkPaymentPriceAffirmation = CoworkCustomerQuote & {
  readonly commitment: DiscountCommitment;
};

interface CoworkCheckoutPricing {
  readonly quoteAdvertisement: (
    input: CoworkAdvertisementQuoteInput
  ) => Effect.Effect<CoworkAdvertisementQuote, CoworkCheckoutPricingError>;
  readonly affirmAdvertisement: (
    input: CoworkAdvertisementAffirmationInput
  ) => Effect.Effect<
    CoworkAdvertisementAffirmation,
    CoworkCheckoutPricingError
  >;
  readonly quoteForCustomer: (
    input: CoworkCustomerQuoteInput
  ) => Effect.Effect<CoworkCustomerQuote, CoworkCheckoutPricingError>;
  readonly affirmForPayment: (
    input: CoworkPaymentPriceAffirmationInput
  ) => Effect.Effect<CoworkPaymentPriceAffirmation, CoworkCheckoutPricingError>;
}

export const coworkCheckoutPricing = Effect.gen(function* () {
  const discounts = yield* DiscountService;

  const quoteAdvertisement = Effect.fn(
    "CoworkCheckoutPricing.quoteAdvertisement"
  )((input: CoworkAdvertisementQuoteInput) =>
    Effect.succeed(input.reservation.details).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("pricing", getCoworkPricingContext),
      Effect.bind("discountQuote", ({ pricing }) =>
        discounts.discoverAdvertisedDiscounts({
          ...pricing.discountInput,
          locale: input.locale,
        })
      ),
      Effect.bind("quote", ({ discountQuote, pricing }) =>
        calculateCoworkReservationQuote(pricing.order, { discountQuote })
      ),
      Effect.map(({ quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        quote,
      }))
    )
  );

  const affirmAdvertisement = Effect.fn(
    "CoworkCheckoutPricing.affirmAdvertisement"
  )((input: CoworkAdvertisementAffirmationInput) =>
    Effect.succeed(input.reservation.details).pipe(
      Effect.bindTo("reservation"),
      Effect.bind("pricing", getCoworkPricingContext),
      Effect.bind("discountQuote", ({ pricing }) =>
        discounts.affirmAdvertisement({
          ...pricing.discountInput,
          locale: input.locale,
          advertisedDiscountIds: input.advertisedQuote.payment.discounts.map(
            ({ discount }) => discount.id
          ),
        })
      ),
      Effect.bind("quote", ({ discountQuote, pricing }) =>
        calculateCoworkReservationQuote(pricing.order, { discountQuote })
      ),
      Effect.map(({ discountQuote, quote }) => ({
        kind: input.reservation.kind,
        reservation: input.reservation,
        discountQuote,
        quote,
      }))
    )
  );

  const quoteForCustomer = Effect.fn("CoworkCheckoutPricing.quoteForCustomer")(
    (input: CoworkCustomerQuoteInput) =>
      Effect.succeed(input.reservation).pipe(
        Effect.bindTo("reservation"),
        Effect.bind("pricing", getCoworkPricingContext),
        Effect.bind("discountQuote", () =>
          discounts.applyCustomerDiscount({
            affirmedAdvertisement: input.affirmedAdvertisement,
            dotyposCustomerId: input.dotyposCustomerId,
            locale: input.locale,
          })
        ),
        Effect.bind("quote", ({ discountQuote, pricing }) =>
          calculateCoworkReservationQuote(pricing.order, { discountQuote })
        ),
        Effect.map(({ quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
        }))
      )
  );

  const affirmForPayment = Effect.fn("CoworkCheckoutPricing.affirmForPayment")(
    (input: CoworkPaymentPriceAffirmationInput) =>
      Effect.succeed(input.reservation).pipe(
        Effect.bindTo("reservation"),
        Effect.bind("pricing", getCoworkPricingContext),
        Effect.bind("affirmation", ({ pricing }) =>
          discounts.affirmForPayment({
            ...pricing.discountInput,
            dotyposCustomerId: input.dotyposCustomerId,
            locale: input.locale,
            submittedCode: input.submittedCode,
            displayedDiscountIds: input.quote.payment.discounts.map(
              ({ discount }) => discount.id
            ),
          })
        ),
        Effect.bind("quote", ({ affirmation, pricing }) =>
          calculateCoworkReservationQuote(pricing.order, {
            discountQuote: affirmation.quote,
          })
        ),
        Effect.map(({ affirmation, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
          commitment: affirmation.commitment,
        }))
      )
  );

  return {
    quoteAdvertisement,
    affirmAdvertisement,
    quoteForCustomer,
    affirmForPayment,
  } satisfies CoworkCheckoutPricing;
});

const getCoworkPricingContext = Effect.fn(
  "CoworkCheckoutPricing.getPricingContext"
)(function* (input: { readonly reservation: CoworkReservationDetails }) {
  const order = yield* normalizeCoworkReservationQuoteOrder(input.reservation);
  const product = getWorkspaceProductByTier(order.entryTier);

  return {
    order,
    discountInput: {
      product: { kind: "cowork" as const, tier: order.entryTier },
      discountableSubtotal: product.price,
      reservationDate: input.reservation.date,
    },
  };
});
