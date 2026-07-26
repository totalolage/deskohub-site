import { Effect, Schema } from "effect";
import {
  type CheckoutSummary,
  type CheckoutSummaryOrderItem,
  checkoutSummaryDiscountedProductItemSchema,
  checkoutSummaryDiscountSchema,
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryProductItemSchema,
  checkoutSummarySchema,
  checkoutSummaryTotalSectionSchema,
} from "@/features/checkout/checkout-summary";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  workspaceCoworkProductTiers,
} from "@/features/checkout/product-catalog";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import { getReservationQuoteFingerprint } from "@/features/checkout/reservation-quote-fingerprint";
import { makeReservationQuoteSchema } from "@/features/checkout/reservation-quote-schema";
import {
  addWorkspaceMoney,
  workspaceMoneyCodec,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import type { DiscountQuote } from "@/features/discounts";
import type { CoworkAdvertisedPriceDetails } from "@/features/reservation/cowork-reservation";
import {
  type CoworkReservationProductInput,
  getCoworkReservationProductCoffee,
  getCoworkReservationProductMonitorOption,
} from "@/features/reservation/cowork-reservation-product";

const coworkProductQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("cowork"),
  tier: Schema.Literals(workspaceCoworkProductTiers),
  amount: workspaceMoneyCodec,
});

const coworkCoffeeQuoteItemSchema = Schema.Struct({
  type: Schema.Literal("coffee"),
  amount: workspaceMoneyCodec,
});

export const coworkReservationQuoteItemSchema = Schema.Union([
  coworkProductQuoteItemSchema,
  coworkCoffeeQuoteItemSchema,
]);

type CoworkProductQuoteItem = typeof coworkProductQuoteItemSchema.Type;
type CoworkCoffeeQuoteItem = typeof coworkCoffeeQuoteItemSchema.Type;

export type CoworkReservationQuoteItem =
  typeof coworkReservationQuoteItemSchema.Type;

export const coworkReservationQuoteSchema = makeReservationQuoteSchema(
  Schema.Union([
    Schema.Tuple([coworkProductQuoteItemSchema]),
    Schema.Tuple([coworkProductQuoteItemSchema, coworkCoffeeQuoteItemSchema]),
  ])
).annotate({
  identifier: "CoworkReservationQuote",
  description: "Authoritative cowork reservation price quote.",
});

export type CoworkReservationQuote = typeof coworkReservationQuoteSchema.Type;

export type CoworkReservationPricingInput = CoworkAdvertisedPriceDetails;

export type CanonicalCoworkReservation = {
  readonly kind: "cowork";
};

export const getCoworkReservationQuote = Effect.fn("getCoworkReservationQuote")(
  function* (
    reservation: CoworkReservationPricingInput,
    options: {
      readonly discountQuote?: DiscountQuote;
    } = {}
  ) {
    const productPrice = getWorkspaceProductByTier(reservation.entryTier).price;
    const productItem: CoworkProductQuoteItem = {
      type: "cowork",
      tier: reservation.entryTier,
      amount: productPrice,
    };
    const addonItems: CoworkCoffeeQuoteItem[] = [];

    if (getCoworkReservationProductCoffee(reservation)) {
      addonItems.push({
        type: "coffee",
        amount: getWorkspaceProductCoffeeLinePriceForTier(
          reservation.entryTier
        ),
      });
    }

    const items:
      | readonly [CoworkProductQuoteItem]
      | readonly [CoworkProductQuoteItem, CoworkCoffeeQuoteItem] =
      addonItems.length === 0 ? [productItem] : [productItem, addonItems[0]!];
    const undiscountedPrice = yield* addWorkspaceMoney(
      items.map((item) => item.amount)
    );
    const discounts = options.discountQuote?.discounts ?? [];
    const discountedProductPrice =
      options.discountQuote?.discountedSubtotal ?? productPrice;
    const expectedPrice = yield* addWorkspaceMoney([
      discountedProductPrice,
      ...addonItems.map((item) => item.amount),
    ]);

    return {
      items,
      payment: {
        expectedPrice,
        undiscountedPrice,
        discounts,
      },
    };
  }
);

export const buildCoworkReservationQuote = Effect.fn(
  "buildCoworkReservationQuote"
)(function* (
  reservation: CoworkReservationPricingInput,
  options: {
    readonly discountQuote?: DiscountQuote;
  } = {}
) {
  const quoteWithoutFingerprint = yield* getCoworkReservationQuote(
    reservation,
    options
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getReservationQuoteFingerprint(
      reservation,
      quoteWithoutFingerprint
    ),
  };
});

export const getCoworkCheckoutSummary = (
  reservation: CoworkReservationProductInput,
  quote: CoworkReservationQuote
): CheckoutSummary => {
  const [productQuoteItem, coffeeQuoteItem] = quote.items;
  const product = {
    kind: productQuoteItem.type,
    tier: productQuoteItem.tier,
  } as const;
  const productKey = `product:${getWorkspaceProductKey(product)}` as const;
  const summaryDiscounts = quote.payment.discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ discount, amount })
  );
  const discountedProductPrice =
    quote.payment.discounts.at(-1)?.subtotalAfter ?? productQuoteItem.amount;
  const productItem =
    summaryDiscounts.length > 0
      ? checkoutSummaryDiscountedProductItemSchema.make({
          key: productKey,
          product,
          amount: discountedProductPrice,
          originalAmount: productQuoteItem.amount,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : checkoutSummaryProductItemSchema.make({
          key: productKey,
          product,
          amount: productQuoteItem.amount,
        });
  const orderItems: CheckoutSummaryOrderItem[] = [productItem];

  if (coffeeQuoteItem) {
    orderItems.push({
      key: "addon:coffee",
      amount: coffeeQuoteItem.amount,
    });
  }

  const monitorOption = getCoworkReservationProductMonitorOption(reservation);
  if (monitorOption) {
    orderItems.push({
      key: `monitor:${monitorOption}`,
      amount: workspaceMoneyWithValue(0, productQuoteItem.amount),
    });
  }

  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: orderItems,
    total: quote.payment.expectedPrice,
  });
  const totalSection = checkoutSummaryTotalSectionSchema.make({
    key: "total",
    items: [
      {
        key: "total:final",
        amount: quote.payment.expectedPrice,
      },
    ],
    total: quote.payment.expectedPrice,
  });

  return checkoutSummarySchema.make({
    sections: [orderSection, totalSection],
    total: quote.payment.expectedPrice,
  });
};
