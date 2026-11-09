import { Effect, Option } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryChangedKeys,
  getCheckoutSummaryChangedKeys,
} from "@/features/checkout/checkout-summary";
import type { ReservationQuotePayment } from "@/features/checkout/reservation-quote-schema";
import {
  type AffirmedDiscountAdvertisementQuote,
  affirmedDiscountAdvertisementQuoteCodec,
  type CanonicalPromotionCode,
  type DiscountAdvertisementInput,
  DiscountAffirmationUnavailableError,
  type DiscountCommitment,
  type DiscountId,
  type DiscountQuote,
  type DiscountResolutionError,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { moneyEquals } from "@/shared/money/money";
import { currentInstant } from "@/shared/utils";
import {
  getSubmittedCodeMetadata,
  type PayStateSubmittedCodeMetadata,
} from "./pay-state-contract";

const getReferralCode = (input: {
  readonly referralCode?: CanonicalPromotionCode;
}) =>
  input.referralCode === undefined ? {} : { referralCode: input.referralCode };

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
  readonly submittedCode?: CanonicalPromotionCode;
};

export type ReservationAdvertisementAffirmationInput<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisementQuoteInput<Reservation> &
  PayStateSubmittedCodeMetadata & {
    readonly advertisedQuote: Quote;
    /** Moment the reservation is submitted and its price is locked. */
    readonly bookedAt: Temporal.Instant;
  };

export type ReservationCustomerQuoteInput<
  Reservation extends ReservationDetails,
> = PayStateSubmittedCodeMetadata & {
  readonly reservation: Reservation;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
};

export type ReservationPaymentPriceAffirmationInput<
  Reservation extends ReservationDetails,
  Quote extends ReservationQuote,
> = {
  readonly reservation: Reservation;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly quote: Quote;
  /** Booking moment stored when the price was locked. */
  readonly bookedAt: Temporal.Instant;
  readonly submittedCode?: CanonicalPromotionCode;
  /** Referral code the checkout carries for an unattributed customer. */
  readonly referralCode?: CanonicalPromotionCode;
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

type ReservationAdvertisedPrice<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = PayStateSubmittedCodeMetadata & {
  readonly kind: Reservation["kind"];
  readonly reservation: Reservation;
  readonly quote: Quote;
};

export type ReservationAdvertisementQuote<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisedPrice<Reservation, Quote> & {
  /**
   * False when a discount source could not answer, so the price may miss a
   * running sale. Such a price is right for this request but not to share.
   */
  readonly discountsComplete: boolean;
};

export type ReservationAdvertisementAffirmation<
  Reservation extends AdvertisedReservation<ReservationDetails>,
  Quote extends ReservationQuote,
> = ReservationAdvertisedPrice<Reservation, Quote> & {
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
};

type ReservationCustomerQuote<
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
  PayStateSubmittedCodeMetadata & {
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
  readonly discountInput: Omit<
    DiscountAdvertisementInput,
    "bookedAt" | "locale"
  >;
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
    | ContextError
    | QuoteError
    | DiscountResolutionError
    | DiscountAffirmationUnavailableError
  >,
  never,
  DiscountService
> =>
  Effect.gen(function* () {
    const discounts = yield* DiscountService;

    /**
     * Previews a query code on top of the anonymous discounts. Discovery omits
     * a code it cannot preview. Affirming an advertised code treats a provider
     * failure as unknown rather than gone, so it fails instead of silently
     * dropping the code; an unavailable code is still gone.
     */
    const previewSubmittedCode = Effect.fn(
      "ReservationCheckoutPricing.previewSubmittedCode"
    )(function* (input: {
      readonly discountQuote: DiscountQuote;
      readonly locale: Locale;
      readonly submittedCode?: CanonicalPromotionCode;
      readonly advertisedCodeDiscountId?: DiscountId;
    }) {
      if (!input.submittedCode) return undefined;

      const preview = yield* discounts
        .previewDiscountCode({
          baseQuote: input.discountQuote,
          locale: input.locale,
          submittedCode: input.submittedCode,
        })
        .pipe(
          Effect.map(Option.some),
          Effect.catch((cause) =>
            cause._tag === "DiscountProviderError" &&
            input.advertisedCodeDiscountId !== undefined
              ? Effect.fail(
                  new DiscountAffirmationUnavailableError({
                    message:
                      "The advertised discount code could not be affirmed because its provider was unavailable.",
                    discountIds: [input.advertisedCodeDiscountId],
                  })
                )
              : Effect.succeed(Option.none())
          ),
          Effect.map(Option.getOrUndefined)
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
        // An advertised price previews a booking made right now.
        Effect.bind("bookedAt", () => currentInstant),
        Effect.bind("advertisement", ({ bookedAt, pricing }) =>
          discounts.discoverAdvertisedDiscounts({
            ...pricing.discountInput,
            bookedAt,
            locale: input.locale,
          })
        ),
        Effect.bind("preview", ({ advertisement }) =>
          previewSubmittedCode({
            discountQuote: advertisement.quote,
            locale: input.locale,
            submittedCode: input.submittedCode,
          })
        ),
        Effect.bind("quote", ({ advertisement, preview, pricing }) =>
          domain.buildQuote({
            pricing,
            discountQuote: preview?.discountQuote ?? advertisement.quote,
          })
        ),
        Effect.map(({ advertisement, preview, quote }) => ({
          kind: input.reservation.kind,
          reservation: input.reservation,
          quote,
          discountsComplete: advertisement.complete,
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
            bookedAt: input.bookedAt,
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
            advertisedCodeDiscountId: input.submittedCodeDiscountId,
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
            ...getReferralCode(input),
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
              bookedAt: input.bookedAt,
              dotyposCustomerId: input.dotyposCustomerId,
              locale: input.locale,
              submittedCode: input.submittedCode,
              ...getReferralCode(input),
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
    )(function* (
      input: ReservationDiscountCodePriceInput<CustomerReservation, Quote>
    ) {
      const { affirmation, pricing, quote } = yield* affirmDisplayedPrice({
        reservation: input.reservation,
        dotyposCustomerId: input.dotyposCustomerId,
        locale: input.locale,
        quote: input.quote,
        bookedAt: input.bookedAt,
        ...getReferralCode(input),
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
        moneyEquals(affirmedSummary.total, displayedSummary.total);

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
        ...getReferralCode(input),
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
    });

    return {
      quoteAdvertisement,
      affirmAdvertisement,
      quoteForCustomer,
      affirmForPayment,
      applyDiscountCode,
    };
  });
