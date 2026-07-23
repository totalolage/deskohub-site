import { Data, Effect, Match, Schema } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductKey,
  workspaceProductIdentitySchema,
  workspaceProductKeySchema,
} from "@/features/checkout/product-identity";
import { reservationQuotePaymentSchema } from "@/features/checkout/reservation-quote-schema";
import {
  addWorkspaceMoney,
  nonNegativeWorkspaceMoneyCodec,
  positiveWorkspaceMoneyCodec,
  withWorkspaceMoneyCurrency,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  type AppliedDiscount,
  appliedDiscountCodec,
  type DiscountQuote,
} from "@/features/discounts/contracts";
import {
  coworkReservationProductSchema,
  normalizedCoworkReservationProductSchema,
  workspaceCoworkProductIdentitySchema,
} from "@/features/reservation/cowork-reservation-product";

export const coworkReservationQuoteOrderSchema =
  normalizedCoworkReservationProductSchema.annotate({
    identifier: "CoworkReservationQuoteOrder",
    description: "Canonical normalized product selection for checkout.",
  });

export type CoworkReservationQuoteOrderInput =
  typeof coworkReservationProductSchema.Encoded;
export type CoworkReservationQuoteOrder =
  typeof coworkReservationQuoteOrderSchema.Type;

export type CheckoutSummaryDiscount = Pick<
  AppliedDiscount,
  "discount" | "amount"
>;

export const checkoutSummaryDiscountSchema: Schema.Codec<
  CheckoutSummaryDiscount,
  Pick<typeof appliedDiscountCodec.Encoded, "discount" | "amount">
> = Schema.Struct({
  discount: appliedDiscountCodec.fields.discount,
  amount: appliedDiscountCodec.fields.amount,
});

const checkoutSummaryProductItemKeySchema = Schema.TemplateLiteral([
  "product:",
  workspaceProductKeySchema,
]);

const checkoutSummaryProductItemBaseSchema = Schema.Struct({
  key: checkoutSummaryProductItemKeySchema,
  product: workspaceProductIdentitySchema,
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryProductItemSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  originalAmount: Schema.optionalKey(Schema.Never),
  discounts: Schema.optionalKey(Schema.Never),
}).check(
  Schema.makeFilter(
    ({ key, product }) =>
      key === `product:${getWorkspaceProductKey(product)}` || {
        path: ["key"],
        issue: "product summary key must match the product identity",
      }
  )
);

export const checkoutSummaryDiscountedProductItemSchema = Schema.Struct({
  ...checkoutSummaryProductItemBaseSchema.fields,
  originalAmount: positiveWorkspaceMoneyCodec,
  discounts: Schema.NonEmptyArray(checkoutSummaryDiscountSchema),
}).check(
  Schema.makeFilter(
    ({ key, product }) =>
      key === `product:${getWorkspaceProductKey(product)}` || {
        path: ["key"],
        issue: "product summary key must match the product identity",
      }
  )
);

export const checkoutSummaryAddOnItemSchema = Schema.Struct({
  key: Schema.Union([
    Schema.Literal("addon:coffee"),
    Schema.TemplateLiteral(["monitor:", Schema.String]),
  ]),
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryOrderItemSchema = Schema.Union([
  checkoutSummaryDiscountedProductItemSchema,
  checkoutSummaryProductItemSchema,
  checkoutSummaryAddOnItemSchema,
]);

export const checkoutSummaryTotalItemSchema = Schema.Struct({
  key: Schema.Literal("total:final"),
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryItemSchema = Schema.Union([
  checkoutSummaryOrderItemSchema,
  checkoutSummaryTotalItemSchema,
]);

export const checkoutSummaryOrderSectionSchema = Schema.Struct({
  key: Schema.Literal("order"),
  items: Schema.Array(checkoutSummaryOrderItemSchema),
  total: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryTotalSectionSchema = Schema.Struct({
  key: Schema.Literal("total"),
  items: Schema.Array(checkoutSummaryTotalItemSchema),
  total: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummarySectionSchema = Schema.Union([
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryTotalSectionSchema,
]);

export const checkoutSummarySchema = Schema.Struct({
  sections: Schema.Array(checkoutSummarySectionSchema),
  total: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "CheckoutSummary",
  description: "Public itemized Workspace checkout summary.",
});

export const coworkReservationQuoteSchema = Schema.Struct({
  fingerprint: Schema.NonEmptyString,
  order: coworkReservationQuoteOrderSchema,
  summary: checkoutSummarySchema,
  payment: reservationQuotePaymentSchema,
}).annotate({
  identifier: "CoworkReservationQuote",
  description: "Authoritative cowork reservation quote snapshot.",
});

export const checkoutSummaryChangedKeysSchema = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
});

export type CheckoutSummaryItem = typeof checkoutSummaryItemSchema.Type;
export type CheckoutSummaryOrderItem =
  typeof checkoutSummaryOrderItemSchema.Type;
export type CheckoutSummarySection = typeof checkoutSummarySectionSchema.Type;
export type CheckoutSummary = typeof checkoutSummarySchema.Type;
export type CoworkReservationQuote = typeof coworkReservationQuoteSchema.Type;
export type CheckoutSummaryChangedKeys =
  typeof checkoutSummaryChangedKeysSchema.Type;

export class CheckoutQuoteError extends Data.TaggedError("CheckoutQuoteError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const normalizeCoworkReservationQuoteOrder = Effect.fn(
  "normalizeCoworkReservationQuoteOrder"
)((order: CoworkReservationQuoteOrderInput) =>
  Schema.decodeUnknownEffect(coworkReservationProductSchema)(order).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutQuoteError({
          message: String(cause),
          cause,
        })
    )
  )
);

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount,
  ...("product" in item && { product: item.product }),
  ...("originalAmount" in item && {
    originalAmount: item.originalAmount,
    discounts: item.discounts,
  }),
});

const getCanonicalAppliedDiscount = (application: AppliedDiscount) => ({
  discount: {
    id: application.discount.id,
    label: application.discount.label,
    adjustment: Match.value(application.discount.adjustment).pipe(
      Match.discriminatorsExhaustive("kind")({
        percentage: (adjustment) => ({
          kind: adjustment.kind,
          basisPoints: adjustment.basisPoints,
        }),
        fixed: (adjustment) => ({
          kind: adjustment.kind,
          amount: adjustment.amount,
        }),
      })
    ),
    expiresAt: application.discount.expiresAt ?? null,
    countdownStartsAt: application.discount.countdownStartsAt ?? null,
  },
  subtotalBefore: application.subtotalBefore,
  amount: application.amount,
  subtotalAfter: application.subtotalAfter,
});

const getQuoteFingerprint = (
  quote: Omit<CoworkReservationQuote, "fingerprint">
) => {
  const coffeePriceAmount = getWorkspaceProductCoffeeLinePriceForTier(
    quote.order.entryTier
  ).value;

  const canonicalPayload = JSON.stringify({
    order: {
      tier: quote.order.entryTier,
      coffee: quote.order.coffee,
      coffeePriceAmount,
      monitorOption: quote.order.monitorOption ?? null,
    },
    currency: quote.summary.total.currency,
    exponent: quote.summary.total.exponent,
    payment: {
      expectedPrice: quote.payment.expectedPrice,
      undiscountedPrice: quote.payment.undiscountedPrice,
      discounts: quote.payment.discounts.map(getCanonicalAppliedDiscount),
    },
    sections: quote.summary.sections.map((section) => ({
      key: section.key,
      items: section.items.map(getCanonicalSummaryItem),
      total: section.total.value,
    })),
    total: quote.summary.total.value,
  });

  return Array.from(canonicalPayload)
    .reduce(
      (hash, character) =>
        Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0,
      0x811c9dc5
    )
    .toString(16);
};

export const calculateCoworkReservationQuote = Effect.fn(
  "calculateCoworkReservationQuote"
)(function* (
  order: CoworkReservationQuoteOrderInput,
  options: {
    readonly discountQuote?: DiscountQuote;
    readonly currencyOverride?: string;
  } = {}
) {
  const normalizedOrder = yield* normalizeCoworkReservationQuoteOrder(order);
  const product = getWorkspaceProductByTier(normalizedOrder.entryTier);
  const productPrice = withWorkspaceMoneyCurrency(
    product.price,
    options.currencyOverride
  );
  const coffeePrice = withWorkspaceMoneyCurrency(
    getWorkspaceProductCoffeeLinePriceForTier(normalizedOrder.entryTier),
    options.currencyOverride
  );
  const productIdentity = workspaceCoworkProductIdentitySchema.make({
    kind: "cowork",
    tier: normalizedOrder.entryTier,
  });
  const productItemKey =
    `product:${getWorkspaceProductKey(productIdentity)}` as const;
  const addOnItems: CheckoutSummaryOrderItem[] = [];

  if (normalizedOrder.coffee) {
    addOnItems.push({
      key: "addon:coffee",
      amount: coffeePrice,
    });
  }

  if (normalizedOrder.monitorOption) {
    addOnItems.push({
      key: `monitor:${normalizedOrder.monitorOption}`,
      amount: workspaceMoneyWithValue(0, productPrice),
    });
  }

  const orderTotal = yield* addWorkspaceMoney([
    productPrice,
    ...addOnItems.map((item) => item.amount),
  ]);
  const discountQuote = options.discountQuote;
  const discounts = discountQuote?.discounts ?? [];
  const discountedProductPrice =
    discountQuote?.discountedSubtotal ?? productPrice;
  const summaryDiscounts = discounts.map(({ amount, discount }) =>
    checkoutSummaryDiscountSchema.make({ discount, amount })
  );
  const productItem =
    summaryDiscounts.length > 0
      ? checkoutSummaryDiscountedProductItemSchema.make({
          key: productItemKey,
          product: productIdentity,
          amount: discountedProductPrice,
          originalAmount: productPrice,
          discounts: [summaryDiscounts[0]!, ...summaryDiscounts.slice(1)],
        })
      : checkoutSummaryProductItemSchema.make({
          key: productItemKey,
          product: productIdentity,
          amount: productPrice,
        });
  const orderItems: CheckoutSummaryOrderItem[] = [productItem, ...addOnItems];
  const expectedPrice = yield* addWorkspaceMoney([
    discountedProductPrice,
    ...addOnItems.map(({ amount }) => amount),
  ]);
  const orderSection = checkoutSummaryOrderSectionSchema.make({
    key: "order",
    items: orderItems,
    total: expectedPrice,
  });
  const sections: CheckoutSummarySection[] = [orderSection];

  sections.push(
    checkoutSummaryTotalSectionSchema.make({
      key: "total",
      items: [
        {
          key: "total:final",
          amount: expectedPrice,
        },
      ],
      total: expectedPrice,
    })
  );

  const summary = checkoutSummarySchema.make({
    sections,
    total: expectedPrice,
  });
  const quoteWithoutFingerprint = {
    order: normalizedOrder,
    summary,
    payment: {
      expectedPrice,
      undiscountedPrice: orderTotal,
      discounts,
    },
  };
  return {
    ...quoteWithoutFingerprint,
    fingerprint: getQuoteFingerprint(quoteWithoutFingerprint),
  };
});

const getSummarySectionMap = (summary: CheckoutSummary) =>
  new Map(summary.sections.map((section) => [section.key, section]));

const getSummaryItemMap = (summary: CheckoutSummary) =>
  new Map(
    summary.sections.flatMap((section) =>
      section.items.map((item) => [item.key, item] as const)
    )
  );

const hasCheckoutSummaryItemChanged = (
  previousItem: CheckoutSummaryItem | undefined,
  nextItem: CheckoutSummaryItem | undefined
) =>
  JSON.stringify(previousItem && getCanonicalSummaryItem(previousItem)) !==
  JSON.stringify(nextItem && getCanonicalSummaryItem(nextItem));

export const getCheckoutSummaryChangedKeys = (
  previous: CheckoutSummary,
  next: CheckoutSummary
): CheckoutSummaryChangedKeys => {
  const previousSections = getSummarySectionMap(previous);
  const nextSections = getSummarySectionMap(next);
  const sectionKeys = Array.from(
    new Set([...previousSections.keys(), ...nextSections.keys()])
  )
    .filter((key) => {
      const previousSection = previousSections.get(key);
      const nextSection = nextSections.get(key);
      return !workspaceMoneyEquals(previousSection?.total, nextSection?.total);
    })
    .sort();
  const previousItems = getSummaryItemMap(previous);
  const nextItems = getSummaryItemMap(next);
  const itemKeys = Array.from(
    new Set([...previousItems.keys(), ...nextItems.keys()])
  )
    .filter((key) => {
      const previousItem = previousItems.get(key);
      const nextItem = nextItems.get(key);
      return hasCheckoutSummaryItemChanged(previousItem, nextItem);
    })
    .sort();

  return { sectionKeys, itemKeys };
};
