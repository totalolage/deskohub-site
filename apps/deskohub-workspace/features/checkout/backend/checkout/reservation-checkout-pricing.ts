import { Effect } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-quote";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import { workspaceMoneyEquals } from "@/features/checkout/workspace-money";
import {
  type AffirmedDiscountAdvertisementQuote,
  type CanonicalDiscountCode,
  type DiscountAdvertisementInput,
  type DiscountCommitment,
  type DiscountId,
  type DiscountQuote,
  type DiscountResolutionError,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";

type ReservationDetails = {
  readonly kind: string;
};

type AdvertisedReservation<Details extends ReservationDetails> = {
  readonly kind: Details["kind"];
  readonly details: Details;
};

type ReservationQuote = {
  readonly fingerprint: string;
  readonly payment: ReservationQuotePayment;
};

export type ReservationAdvertisementQuoteInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
> = {
  readonly reservation: Reservation;
  readonly locale: Locale;
};

export type ReservationAdvertisementAffirmationInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisementQuoteInput<Reservation> & {
  readonly advertisedQuote: Quote;
};

export type ReservationCustomerQuoteInput<
  Reservation extends ReservationDetails,
> = {
  readonly reservation: Reservation;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
};

export type ReservationPaymentPriceAffirmationInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  readonly reservation: Reservation;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly quote: Quote;
  readonly submittedCode?: CanonicalDiscountCode;
};

export type ReservationDiscountCodePriceInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = Omit<
  ReservationPaymentPriceAffirmationInput<Reservation, Quote>,
  "submittedCode"
> & {
  readonly submittedCode: CanonicalDiscountCode;
};

export type ReservationAdvertisementQuote<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = {
  readonly kind: Reservation["kind"];
  readonly reservation: Reservation;
  readonly quote: Quote;
};

export type ReservationAdvertisementAffirmation<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisementQuote<Reservation, Quote> & {
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
};

export type ReservationCustomerQuote<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  readonly kind: Reservation["kind"];
  readonly reservation: Reservation;
  readonly quote: Quote;
};

export type ReservationPaymentPriceAffirmation<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationCustomerQuote<Reservation, Quote> & {
  readonly commitment: DiscountCommitment;
};

export type ReservationDiscountCodePriceResult<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> =
  | (ReservationCustomerQuote<Reservation, Quote> & {
      readonly status: "pricing_changed";
      readonly changedKeys: CheckoutSummaryChangedKeys;
    })
  | (ReservationCustomerQuote<Reservation, Quote> & {
      readonly status: "applied";
      readonly submittedCodeDiscountId: DiscountId;
    });

type PricingContext = {
  readonly discountInput: Omit<DiscountAdvertisementInput, "locale">;
};

type ReservationPricingDomain<
  Details extends ReservationDetails,
  Context extends PricingContext,
  Quote extends ReservationQuote,
  ContextError,
  QuoteError,
> = {
  readonly getPricingContext: (
    reservation: Details
  ) => Effect.Effect<Context, ContextError>;
  readonly buildQuote: (input: {
    readonly pricing: Context;
    readonly discountQuote: DiscountQuote;
  }) => Effect.Effect<Quote, QuoteError>;
  readonly getCheckoutSummary: (quote: Quote) => CheckoutSummary;
};

interface ReservationCheckoutPricing<
  Details extends ReservationDetails,
  Advertisement extends AdvertisedReservation<Details>,
  CustomerReservation extends Details,
  Quote extends ReservationQuote,
  Error,
> {
  readonly quoteAdvertisement: (
    input: ReservationAdvertisementQuoteInput<Advertisement>
  ) => Effect.Effect<
    ReservationAdvertisementQuote<Advertisement, Quote>,
    Error
  >;
  readonly affirmAdvertisement: (
    input: ReservationAdvertisementAffirmationInput<Advertisement, Quote>
  ) => Effect.Effect<
    ReservationAdvertisementAffirmation<Advertisement, Quote>,
    Error
  >;
  readonly quoteForCustomer: (
    input: ReservationCustomerQuoteInput<CustomerReservation>
  ) => Effect.Effect<
    ReservationCustomerQuote<CustomerReservation, Quote>,
    Error
  >;
  readonly affirmForPayment: (
    input: ReservationPaymentPriceAffirmationInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    ReservationPaymentPriceAffirmation<CustomerReservation, Quote>,
    Error
  >;
  readonly applyDiscountCode: (
    input: ReservationDiscountCodePriceInput<CustomerReservation, Quote>
  ) => Effect.Effect<
    ReservationDiscountCodePriceResult<CustomerReservation, Quote>,
    Error
  >;
}

export const reservationCheckoutPricing = <
  Details extends ReservationDetails,
  Advertisement extends AdvertisedReservation<Details>,
  CustomerReservation extends Details,
  Context extends PricingContext,
  Quote extends ReservationQuote,
  ContextError,
  QuoteError,
>(
  domain: ReservationPricingDomain<
    Details,
    Context,
    Quote,
    ContextError,
    QuoteError
  >
): Effect.Effect<
  ReservationCheckoutPricing<
    Details,
    Advertisement,
    CustomerReservation,
    Quote,
    ContextError | QuoteError | DiscountResolutionError
  >,
  never,
  DiscountService
> =>
  Effect.gen(function* () {
    const discounts = yield* DiscountService;

    const quoteAdvertisement = Effect.fn(
      "ReservationCheckoutPricing.quoteAdvertisement"
    )((input: ReservationAdvertisementQuoteInput<Advertisement>) =>
      domain.getPricingContext(input.reservation.details).pipe(
        Effect.bindTo("pricing"),
        Effect.bind("discountQuote", ({ pricing }) =>
          discounts.discoverAdvertisedDiscounts({
            ...pricing.discountInput,
            locale: input.locale,
          })
        ),
        Effect.bind("quote", ({ discountQuote, pricing }) =>
          domain.buildQuote({ pricing, discountQuote })
        ),
        Effect.map(({ quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
        }))
      )
    );

    const affirmAdvertisement = Effect.fn(
      "ReservationCheckoutPricing.affirmAdvertisement"
    )((input: ReservationAdvertisementAffirmationInput<Advertisement, Quote>) =>
      domain.getPricingContext(input.reservation.details).pipe(
        Effect.bindTo("pricing"),
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
          domain.buildQuote({ pricing, discountQuote })
        ),
        Effect.map(({ discountQuote, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          discountQuote,
          quote,
        }))
      )
    );

    const quoteForCustomer = Effect.fn(
      "ReservationCheckoutPricing.quoteForCustomer"
    )((input: ReservationCustomerQuoteInput<CustomerReservation>) =>
      domain.getPricingContext(input.reservation).pipe(
        Effect.bindTo("pricing"),
        Effect.bind("discountQuote", () =>
          discounts.applyCustomerDiscount({
            affirmedAdvertisement: input.affirmedAdvertisement,
            dotyposCustomerId: input.dotyposCustomerId,
            locale: input.locale,
          })
        ),
        Effect.bind("quote", ({ discountQuote, pricing }) =>
          domain.buildQuote({ pricing, discountQuote })
        ),
        Effect.map(({ quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
        }))
      )
    );

    const affirmDisplayedPrice = Effect.fn(
      "ReservationCheckoutPricing.affirmDisplayedPrice"
    )(
      (
        input: ReservationPaymentPriceAffirmationInput<
          CustomerReservation,
          Quote
        >
      ) =>
        domain.getPricingContext(input.reservation).pipe(
          Effect.bindTo("pricing"),
          Effect.bind("affirmation", ({ pricing }) =>
            discounts.affirmDisplayedDiscounts({
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
            domain.buildQuote({
              pricing,
              discountQuote: affirmation.quote,
            })
          )
        )
    );

    const affirmForPayment = Effect.fn(
      "ReservationCheckoutPricing.affirmForPayment"
    )(
      (
        input: ReservationPaymentPriceAffirmationInput<
          CustomerReservation,
          Quote
        >
      ) =>
        affirmDisplayedPrice(input).pipe(
          Effect.map(({ affirmation, quote }) => ({
            kind: input.reservation.kind,
            reservation: input.reservation,
            quote,
            commitment: affirmation.commitment,
          }))
        )
    );

    const applyDiscountCode = Effect.fn(
      "ReservationCheckoutPricing.applyDiscountCode"
    )((input: ReservationDiscountCodePriceInput<CustomerReservation, Quote>) =>
      Effect.gen(function* () {
        const { affirmation, pricing, quote } = yield* affirmDisplayedPrice({
          reservation: input.reservation,
          dotyposCustomerId: input.dotyposCustomerId,
          locale: input.locale,
          quote: input.quote,
        });
        const displayedSummary = domain.getCheckoutSummary(input.quote);
        const affirmedSummary = domain.getCheckoutSummary(quote);
        const displayedPriceIsCurrent =
          quote.fingerprint === input.quote.fingerprint &&
          workspaceMoneyEquals(affirmedSummary.total, displayedSummary.total);

        if (!displayedPriceIsCurrent) {
          return {
            kind: input.reservation.kind,
            reservation: input.reservation,
            quote,
            status: "pricing_changed" as const,
            changedKeys: getCheckoutSummaryChangedKeys(
              displayedSummary,
              affirmedSummary
            ),
          };
        }

        const appliedCode = yield* discounts.applyDiscountCode({
          baseQuote: affirmation.quote,
          dotyposCustomerId: input.dotyposCustomerId,
          locale: input.locale,
          submittedCode: input.submittedCode,
        });
        const appliedQuote = yield* domain.buildQuote({
          pricing,
          discountQuote: appliedCode.quote,
        });

        return {
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote: appliedQuote,
          status: "applied" as const,
          submittedCodeDiscountId: appliedCode.application.discount.id,
        };
      })
    );

    return {
      quoteAdvertisement,
      affirmAdvertisement,
      quoteForCustomer,
      affirmForPayment,
      applyDiscountCode,
    };
  });
