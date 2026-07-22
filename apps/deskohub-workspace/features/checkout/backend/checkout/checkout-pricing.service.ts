import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  type CheckoutQuoteError,
  calculateWorkspaceCheckoutQuote,
  normalizeWorkspaceCheckoutOrder,
  type WorkspaceCheckoutQuote,
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
import type { CoworkReservationDetails } from "@/features/reservation/cowork-reservation";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";

export type CheckoutPricingError =
  | CheckoutQuoteError
  | WorkspaceMoneyError
  | DiscountCalculationError
  | CheckoutPricingInputError;

export class CheckoutPricingInputError extends Data.TaggedError(
  "CheckoutPricingInputError"
)<{
  readonly field: "dotyposCustomerId";
  readonly cause: unknown;
}> {}

export type AdvertisementAffirmation = {
  readonly quote: WorkspaceCheckoutQuote;
  readonly discountQuote: AffirmedDiscountAdvertisementQuote;
};

export type PaymentPriceAffirmation = {
  readonly quote: WorkspaceCheckoutQuote;
  readonly commitment: DiscountCommitment;
};

export type AdvertisementQuoteInput = {
  readonly reservation: CoworkReservationDetails;
  readonly locale: Locale;
};

export type AdvertisementAffirmationInput = AdvertisementQuoteInput & {
  readonly advertisedQuote: WorkspaceCheckoutQuote;
};

export type CustomerQuoteInput = AdvertisementQuoteInput & {
  readonly dotyposCustomerId: string;
  readonly affirmedAdvertisement: AffirmedDiscountAdvertisementQuote;
};

export type PaymentPriceAffirmationInput = AdvertisementQuoteInput & {
  readonly dotyposCustomerId: string;
  readonly displayedQuote: WorkspaceCheckoutQuote;
  readonly submittedCode?: CanonicalDiscountCode;
};

export interface ICheckoutPricingService {
  readonly quoteAdvertisement: (
    input: AdvertisementQuoteInput
  ) => Effect.Effect<WorkspaceCheckoutQuote, CheckoutPricingError>;
  readonly affirmAdvertisement: (
    input: AdvertisementAffirmationInput
  ) => Effect.Effect<AdvertisementAffirmation, CheckoutPricingError>;
  readonly quoteForCustomer: (
    input: CustomerQuoteInput
  ) => Effect.Effect<WorkspaceCheckoutQuote, CheckoutPricingError>;
  readonly affirmForPayment: (
    input: PaymentPriceAffirmationInput
  ) => Effect.Effect<PaymentPriceAffirmation, CheckoutPricingError>;
}

export class CheckoutPricingService extends Context.Service<
  CheckoutPricingService,
  ICheckoutPricingService
>()("@deskohub-workspace/checkout/CheckoutPricingService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const discounts = yield* DiscountService;
      const decodeDotyposCustomerId = Schema.decodeUnknownEffect(
        dotyposCustomerIdSchema
      );

      const getDotyposCustomerId = Effect.fn(
        "CheckoutPricingService.getDotyposCustomerId"
      )((value: string) =>
        decodeDotyposCustomerId(value).pipe(
          Effect.mapError(
            (cause) =>
              new CheckoutPricingInputError({
                field: "dotyposCustomerId",
                cause,
              })
          )
        )
      );

      const getPricingContext = Effect.fn(
        "CheckoutPricingService.getPricingContext"
      )(function* (input: { readonly reservation: CoworkReservationDetails }) {
        const order = yield* normalizeWorkspaceCheckoutOrder(input.reservation);
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

      const quoteAdvertisement = Effect.fn(
        "CheckoutPricingService.quoteAdvertisement"
      )((input: AdvertisementQuoteInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getPricingContext),
          Effect.bind("discountQuote", ({ pricing }) =>
            discounts.discoverAdvertisedDiscounts({
              ...pricing.discountInput,
              locale: input.locale,
            })
          ),
          Effect.bind("quote", ({ discountQuote, pricing }) =>
            calculateWorkspaceCheckoutQuote(pricing.order, { discountQuote })
          ),
          Effect.map(({ quote }) => quote)
        )
      );

      const affirmAdvertisement = Effect.fn(
        "CheckoutPricingService.affirmAdvertisement"
      )((input: AdvertisementAffirmationInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getPricingContext),
          Effect.bind("discountQuote", ({ pricing }) =>
            discounts.affirmAdvertisement({
              ...pricing.discountInput,
              locale: input.locale,
              advertisedDiscountIds:
                input.advertisedQuote.payment.discounts.map(
                  ({ discount }) => discount.id
                ),
            })
          ),
          Effect.bind("quote", ({ discountQuote, pricing }) =>
            calculateWorkspaceCheckoutQuote(pricing.order, { discountQuote })
          ),
          Effect.map(({ discountQuote, quote }) => ({ discountQuote, quote }))
        )
      );

      const quoteForCustomer = Effect.fn(
        "CheckoutPricingService.quoteForCustomer"
      )((input: CustomerQuoteInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getPricingContext),
          Effect.bind("dotyposCustomerId", () =>
            getDotyposCustomerId(input.dotyposCustomerId)
          ),
          Effect.bind("discountQuote", ({ dotyposCustomerId }) =>
            discounts.applyCustomerDiscount({
              affirmedAdvertisement: input.affirmedAdvertisement,
              dotyposCustomerId,
              locale: input.locale,
            })
          ),
          Effect.bind("quote", ({ discountQuote, pricing }) =>
            calculateWorkspaceCheckoutQuote(pricing.order, { discountQuote })
          ),
          Effect.map(({ quote }) => quote)
        )
      );

      const affirmForPayment = Effect.fn(
        "CheckoutPricingService.affirmForPayment"
      )((input: PaymentPriceAffirmationInput) =>
        Effect.succeed(input).pipe(
          Effect.bind("pricing", getPricingContext),
          Effect.bind("dotyposCustomerId", () =>
            getDotyposCustomerId(input.dotyposCustomerId)
          ),
          Effect.bind("affirmation", ({ dotyposCustomerId, pricing }) =>
            discounts.affirmForPayment({
              ...pricing.discountInput,
              dotyposCustomerId,
              locale: input.locale,
              submittedCode: input.submittedCode,
              displayedDiscountIds: input.displayedQuote.payment.discounts.map(
                ({ discount }) => discount.id
              ),
            })
          ),
          Effect.bind("quote", ({ affirmation, pricing }) =>
            calculateWorkspaceCheckoutQuote(pricing.order, {
              discountQuote: affirmation.quote,
            })
          ),
          Effect.map(({ affirmation, quote }) => ({
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
      } satisfies ICheckoutPricingService;
    })
  );
}
