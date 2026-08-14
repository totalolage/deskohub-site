import { Effect, Option } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import { workspaceMoneyEquals } from "@/features/checkout/workspace-money";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalPromotionCode,
  type DiscountAdvertisementInput,
  type DiscountCommitment,
  type DiscountId,
  type DiscountQuote,
  type DiscountResolutionError,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { getSubmittedCodeMetadata } from "./pay-state-contract";

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

type SubmittedCodeMetadata =
  | {
      readonly submittedCode: CanonicalPromotionCode;
      readonly submittedCodeDiscountId: DiscountId;
    }
  | {
      readonly submittedCode?: never;
      readonly submittedCodeDiscountId?: never;
    };

export type ReservationAdvertisementQuoteInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
> = {
  readonly reservation: Reservation;
  readonly locale: Locale;
  readonly submittedCode?: CanonicalPromotionCode;
};

export type ReservationAdvertisementAffirmationInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisementQuoteInput<Reservation> &
  SubmittedCodeMetadata & {
    readonly advertisedQuote: Quote;
  };

export type ReservationCustomerQuoteInput<
  Reservation extends ReservationDetails,
> = SubmittedCodeMetadata & {
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
  readonly submittedCode?: CanonicalPromotionCode;
};

export type ReservationDiscountCodePriceInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = Omit<
  ReservationPaymentPriceAffirmationInput<Reservation, Quote>,
  "submittedCode"
> & {
  readonly submittedCode: CanonicalPromotionCode;
};

export type ReservationAdvertisementQuote<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = SubmittedCodeMetadata & {
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

export type ReservationPreparedCustomerQuote<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = ReservationCustomerQuote<Reservation, Quote> &
  SubmittedCodeMetadata & {
    readonly advertisedPriceChanged?: boolean;
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
  readonly getCheckoutSummary: (input: {
    readonly reservation: Details;
    readonly quote: Quote;
  }) => CheckoutSummary;
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
    ReservationPreparedCustomerQuote<CustomerReservation, Quote>,
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

    const previewSubmittedCode = Effect.fn(
      "ReservationCheckoutPricing.previewSubmittedCode"
    )(function* (input: {
      readonly discountQuote: DiscountQuote;
      readonly locale: Locale;
      readonly submittedCode?: CanonicalPromotionCode;
    }) {
      if (!input.submittedCode) return undefined;

      const preview = Option.getOrUndefined(
        yield* discounts
          .previewDiscountCode({
            baseQuote: input.discountQuote,
            locale: input.locale,
            submittedCode: input.submittedCode,
          })
          .pipe(Effect.option)
      );
      if (
        !preview ||
        input.discountQuote.discounts.some(
          ({ discount }) => discount.id === preview.application.discount.id
        )
      ) {
        return undefined;
      }

      return {
        discountQuote: preview.quote,
        submittedCode: input.submittedCode,
        submittedCodeDiscountId: preview.application.discount.id,
      };
    });

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
        Effect.bind("preview", ({ discountQuote }) =>
          previewSubmittedCode({
            discountQuote,
            locale: input.locale,
            submittedCode: input.submittedCode,
          })
        ),
        Effect.bind("quote", ({ discountQuote, preview, pricing }) =>
          domain.buildQuote({
            pricing,
            discountQuote: preview?.discountQuote ?? discountQuote,
          })
        ),
        Effect.map(({ preview, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
          ...getSubmittedCodeMetadata(preview ?? {}),
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
            advertisedDiscountIds: input.advertisedQuote.payment.discounts
              .map(({ discount }) => discount.id)
              .filter(
                (discountId) => discountId !== input.submittedCodeDiscountId
              ),
          })
        ),
        Effect.bind("preview", ({ discountQuote }) =>
          previewSubmittedCode({
            discountQuote,
            locale: input.locale,
            submittedCode: input.submittedCode,
          })
        ),
        Effect.bind("quote", ({ discountQuote, preview, pricing }) =>
          domain.buildQuote({
            pricing,
            discountQuote: preview?.discountQuote ?? discountQuote,
          })
        ),
        Effect.map(({ discountQuote, preview, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          discountQuote: preview
            ? affirmedDiscountAdvertisementQuoteCodec.make(
                preview.discountQuote
              )
            : discountQuote,
          quote,
          ...getSubmittedCodeMetadata(preview ?? {}),
        }))
      )
    );

    const quoteForCustomer = Effect.fn(
      "ReservationCheckoutPricing.quoteForCustomer"
    )((input: ReservationCustomerQuoteInput<CustomerReservation>) =>
      domain.getPricingContext(input.reservation).pipe(
        Effect.bindTo("pricing"),
        Effect.bind("customerQuote", () =>
          discounts.applyCustomerDiscount({
            affirmedAdvertisement: input.affirmedAdvertisement,
            dotyposCustomerId: input.dotyposCustomerId,
            locale: input.locale,
            ...getSubmittedCodeMetadata(input),
          })
        ),
        Effect.bind("quote", ({ customerQuote, pricing }) =>
          domain.buildQuote({ pricing, discountQuote: customerQuote })
        ),
        Effect.map(({ customerQuote, quote }) => ({
          advertisedPriceChanged: customerQuote.advertisedPriceChanged,
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
          ...getSubmittedCodeMetadata({
            submittedCode: input.submittedCode,
            submittedCodeDiscountId: customerQuote.submittedCodeDiscountId,
          }),
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
        const displayedSummary = domain.getCheckoutSummary({
          reservation: input.reservation,
          quote: input.quote,
        });
        const affirmedSummary = domain.getCheckoutSummary({
          reservation: input.reservation,
          quote,
        });
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
