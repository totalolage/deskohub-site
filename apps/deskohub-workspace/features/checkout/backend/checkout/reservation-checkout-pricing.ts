import { Effect } from "effect";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import {
  type AffirmedDiscountAdvertisementQuote,
  type CanonicalDiscountCode,
  type DiscountAdvertisementInput,
  type DiscountCalculationError,
  type DiscountCommitment,
  type DiscountQuote,
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
    ContextError | QuoteError | DiscountCalculationError
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

    const affirmForPayment = Effect.fn(
      "ReservationCheckoutPricing.affirmForPayment"
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
            domain.buildQuote({
              pricing,
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
    };
  });
