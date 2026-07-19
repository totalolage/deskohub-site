import { Data, Effect, Match, Schema } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
} from "@/features/checkout/product-catalog";
import {
  addWorkspaceMoney,
  nonNegativeWorkspaceMoneyCodec,
  withWorkspaceMoneyCurrency,
  workspaceMoneyCodec,
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
} from "@/features/reservation/cowork-reservation-product";

export const workspaceCheckoutOrderSchema =
  normalizedCoworkReservationProductSchema.annotate({
    identifier: "WorkspaceCheckoutOrder",
    description: "Canonical normalized product selection for checkout.",
  });

export type WorkspaceCheckoutOrderInput =
  typeof coworkReservationProductSchema.Encoded;
export type WorkspaceCheckoutOrder = typeof workspaceCheckoutOrderSchema.Type;

const checkoutSummaryItemBaseSchema = Schema.Struct({
  key: Schema.NonEmptyString,
  amount: workspaceMoneyCodec,
});

export const checkoutSummaryItemSchema = Schema.Struct({
  ...checkoutSummaryItemBaseSchema.fields,
  label: Schema.optional(Schema.NonEmptyString),
});

const nonNegativeCheckoutSummaryItemSchema = Schema.Struct({
  ...checkoutSummaryItemSchema.fields,
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummarySectionSchema = Schema.Union([
  Schema.Struct({
    key: Schema.Literal("order"),
    items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
    total: nonNegativeWorkspaceMoneyCodec,
  }),
  Schema.Struct({
    key: Schema.Literal("discount"),
    items: Schema.Array(
      Schema.Struct({
        ...checkoutSummaryItemBaseSchema.fields,
        label: Schema.NonEmptyString,
      })
    ),
    total: workspaceMoneyCodec,
  }),
  Schema.Struct({
    key: Schema.Literal("total"),
    items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
    total: nonNegativeWorkspaceMoneyCodec,
  }),
]);

export const checkoutSummarySchema = Schema.Struct({
  sections: Schema.Array(checkoutSummarySectionSchema),
  total: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "CheckoutSummary",
  description: "Public itemized Workspace checkout summary.",
});

export const workspaceCheckoutQuoteSchema = Schema.Struct({
  fingerprint: Schema.NonEmptyString,
  order: workspaceCheckoutOrderSchema,
  summary: checkoutSummarySchema,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
  }),
}).annotate({
  identifier: "WorkspaceCheckoutQuote",
  description: "Authoritative Workspace checkout quote snapshot.",
});

export const checkoutSummaryChangedKeysSchema = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
});

export type CheckoutSummaryItem = typeof checkoutSummaryItemSchema.Type;
export type CheckoutSummarySection = typeof checkoutSummarySectionSchema.Type;
export type CheckoutSummary = typeof checkoutSummarySchema.Type;
export type WorkspaceCheckoutQuote = typeof workspaceCheckoutQuoteSchema.Type;
export type CheckoutSummaryChangedKeys =
  typeof checkoutSummaryChangedKeysSchema.Type;

export class CheckoutQuoteError extends Data.TaggedError("CheckoutQuoteError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const normalizeWorkspaceCheckoutOrder = Effect.fn(
  "normalizeWorkspaceCheckoutOrder"
)((order: WorkspaceCheckoutOrderInput) =>
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
  label: item.label ?? null,
  amount: item.amount.value,
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
  quote: Omit<WorkspaceCheckoutQuote, "fingerprint">
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

export const calculateWorkspaceCheckoutQuote = Effect.fn(
  "buildWorkspaceCheckoutQuote"
)(function* (
  order: WorkspaceCheckoutOrderInput,
  options: {
    readonly discountQuote?: DiscountQuote;
    readonly currencyOverride?: string;
  } = {}
) {
  const normalizedOrder = yield* normalizeWorkspaceCheckoutOrder(order);
  const product = getWorkspaceProductByTier(normalizedOrder.entryTier);
  const productPrice = withWorkspaceMoneyCurrency(
    product.price,
    options.currencyOverride
  );
  const coffeePrice = withWorkspaceMoneyCurrency(
    getWorkspaceProductCoffeeLinePriceForTier(normalizedOrder.entryTier),
    options.currencyOverride
  );
  const productItem: CheckoutSummaryItem = {
    key: `product:${normalizedOrder.entryTier}`,
    amount: productPrice,
  };
  const addOnItems: CheckoutSummaryItem[] = [];

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

  const orderItems = [productItem, ...addOnItems];
  const orderTotal = yield* addWorkspaceMoney(
    orderItems.map((item) => item.amount)
  );
  const discountQuote = options.discountQuote;

  const discounts = discountQuote?.discounts ?? [];
  const discountedProductPrice =
    discountQuote?.discountedSubtotal ?? productPrice;
  const expectedPrice = yield* addWorkspaceMoney([
    discountedProductPrice,
    ...addOnItems.map(({ amount }) => amount),
  ]);
  const orderSection: CheckoutSummarySection = {
    key: "order",
    items: orderItems,
    total: orderTotal,
  };
  const sections: CheckoutSummarySection[] = [orderSection];

  if (discounts.length > 0) {
    const discountItems = discounts.map((application) => ({
      key: `discount:${application.discount.id}`,
      label: application.discount.label,
      amount: workspaceMoneyWithValue(
        -application.amount.value,
        application.amount
      ),
    }));
    const discountTotal = yield* addWorkspaceMoney(
      discountItems.map(({ amount }) => amount)
    );
    sections.push({
      key: "discount",
      items: discountItems,
      total: discountTotal,
    });
  }

  sections.push({
    key: "total",
    items: [
      {
        key: "total:final",
        amount: expectedPrice,
      },
    ],
    total: expectedPrice,
  });

  const summary: CheckoutSummary = {
    sections,
    total: expectedPrice,
  };
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
      section.items.map((item) => [`${section.key}/${item.key}`, item] as const)
    )
  );

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
      return (
        previousItem?.label !== nextItem?.label ||
        !workspaceMoneyEquals(previousItem?.amount, nextItem?.amount)
      );
    })
    .sort();

  return { sectionKeys, itemKeys };
};
