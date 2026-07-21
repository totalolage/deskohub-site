import { Effect } from "effect";
import {
  calculateWorkspaceCheckoutQuote,
  normalizeWorkspaceCheckoutOrder,
  type WorkspaceCheckoutQuote,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { withWorkspaceMoneyCurrency } from "@/features/checkout/workspace-money";
import {
  type CanonicalDiscountCode,
  type DiscountAdvertisementQuote,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const buildAuthoritativeWorkspaceCheckoutQuote = Effect.fn(
  "buildAuthoritativeWorkspaceCheckoutQuote"
)(
  function* (input: {
    readonly reservation: NormalizedCoworkReservationOrder;
    readonly dotyposCustomerId: string;
    readonly locale: Locale;
    readonly submittedCode?: CanonicalDiscountCode;
  }) {
    yield* Effect.annotateLogsScoped({
      reservation: input.reservation,
      dotyposCustomerId: input.dotyposCustomerId,
      submittedCode: input.submittedCode,
    });
    yield* Effect.logInfo(
      "Workspace checkout quote discount resolution started"
    );

    const pricing = yield* getWorkspaceCheckoutPricingContext(input);
    const discounts = yield* DiscountService;
    const discountQuote = yield* discounts.quote({
      ...pricing.discountInput,
      dotyposCustomerId: input.dotyposCustomerId,
      locale: input.locale,
      submittedCode: input.submittedCode,
    });
    yield* Effect.annotateLogsScoped({ discountQuote });
    yield* Effect.logInfo("Workspace checkout quote discount resolved");

    const quote = yield* calculateWorkspaceCheckoutQuote(pricing.order, {
      discountQuote,
      currencyOverride: pricing.currencyOverride,
    });
    yield* Effect.annotateLogsScoped({ quote });
    yield* Effect.logInfo("Authoritative workspace checkout quote built");

    return quote;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.tapError((cause) =>
        Effect.logError("Authoritative workspace checkout quote failed", {
          cause,
        })
      )
    )
);

const getWorkspaceCheckoutPricingContext = Effect.fn(
  "getWorkspaceCheckoutPricingContext"
)(function* (input: {
  readonly reservation: NormalizedCoworkReservationOrder;
}) {
  const order = yield* normalizeWorkspaceCheckoutOrder(input.reservation);
  const currencyOverride = getNexiCheckoutCurrencyOverride();
  const product = getWorkspaceProductByTier(order.entryTier);

  return {
    order,
    currencyOverride,
    discountInput: {
      product: { kind: "cowork" as const, tier: order.entryTier },
      discountableSubtotal: withWorkspaceMoneyCurrency(
        product.price,
        currencyOverride
      ),
      reservationDate: input.reservation.date,
    },
  };
});

export const affirmWorkspaceAdvertisedPrice = Effect.fn(
  "affirmWorkspaceAdvertisedPrice"
)(function* (input: {
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly locale: Locale;
  readonly advertisedQuote: WorkspaceCheckoutQuote;
}) {
  const pricing = yield* getWorkspaceCheckoutPricingContext(input);
  const discounts = yield* DiscountService;
  const discountQuote = yield* discounts.affirmAdvertisement({
    ...pricing.discountInput,
    locale: input.locale,
    acceptedDiscountIds: input.advertisedQuote.payment.discounts.map(
      ({ discount }) => discount.id
    ),
  });
  const quote = yield* calculateWorkspaceCheckoutQuote(pricing.order, {
    discountQuote,
    currencyOverride: pricing.currencyOverride,
  });

  return { discountQuote, quote };
});

export const buildIdentifiedWorkspaceCheckoutQuote = Effect.fn(
  "buildIdentifiedWorkspaceCheckoutQuote"
)(function* (input: {
  readonly reservation: NormalizedCoworkReservationOrder;
  readonly locale: Locale;
  readonly dotyposCustomerId: string;
  readonly advertisementQuote: DiscountAdvertisementQuote;
}) {
  const pricing = yield* getWorkspaceCheckoutPricingContext(input);
  const discounts = yield* DiscountService;
  const discountQuote = yield* discounts.quoteIdentified({
    advertisementQuote: input.advertisementQuote,
    dotyposCustomerId: input.dotyposCustomerId,
    locale: input.locale,
  });

  return yield* calculateWorkspaceCheckoutQuote(pricing.order, {
    discountQuote,
    currencyOverride: pricing.currencyOverride,
  });
});
