import { Data, Effect } from "effect";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import {
  addWorkspaceMoney,
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import type { AppliedDiscount, DiscountQuote } from "@/features/discounts";

export type WorkspaceCheckoutOrder = {
  readonly entryTier: WorkspaceProductTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type CheckoutSummaryItem = {
  readonly key: string;
  readonly label?: string;
  readonly amount: WorkspaceMoney;
};

export type CheckoutSummarySection = {
  readonly key: "order" | "discount" | "total";
  readonly items: readonly CheckoutSummaryItem[];
  readonly total: WorkspaceMoney;
};

export type CheckoutSummary = {
  readonly schema: "workspace-checkout-summary";
  readonly sections: readonly CheckoutSummarySection[];
  readonly total: WorkspaceMoney;
};

export type WorkspaceCheckoutQuote = {
  readonly schema: "workspace-checkout-quote";
  readonly order: WorkspaceCheckoutOrder;
  readonly summary: CheckoutSummary;
  readonly fingerprint: string;
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
    readonly undiscountedPrice: WorkspaceMoney;
    readonly discounts: readonly AppliedDiscount[];
  };
};

export type CheckoutSummaryChangedKeys = {
  readonly sectionKeys: readonly string[];
  readonly itemKeys: readonly string[];
};

export class CheckoutQuoteError extends Data.TaggedError("CheckoutQuoteError")<{
  readonly message: string;
}> {}

export const normalizeWorkspaceCheckoutOrder = Effect.fn(
  "normalizeWorkspaceCheckoutOrder"
)(function* (order: WorkspaceCheckoutOrder) {
  const product = getWorkspaceProductByTier(order.entryTier);

  if (product.requiresMonitorOption && !order.monitorOption) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is required for this entry tier.",
      })
    );
  }

  if (
    product.requiresMonitorOption &&
    order.monitorOption &&
    !product.allowedMonitorOptions.includes(order.monitorOption)
  ) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is unavailable for this entry tier.",
      })
    );
  }

  if (!product.requiresMonitorOption && order.monitorOption) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is unavailable for this entry tier.",
      })
    );
  }

  const normalizedOrder: WorkspaceCheckoutOrder = {
    entryTier: order.entryTier,
    coffee: product.requiresCoffee ? true : order.coffee,
    ...(order.monitorOption && { monitorOption: order.monitorOption }),
  };

  return normalizedOrder;
});

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  label: item.label ?? null,
  amount: item.amount.value,
});

const getCanonicalMoney = (money: WorkspaceMoney) => ({
  value: money.value,
  exponent: money.exponent,
  currency: money.currency,
});

const getCanonicalAppliedDiscount = (application: AppliedDiscount) => ({
  discount: {
    id: application.discount.id,
    label: application.discount.label,
    adjustment:
      application.discount.adjustment.kind === "percentage"
        ? {
            kind: application.discount.adjustment.kind,
            basisPoints: application.discount.adjustment.basisPoints,
          }
        : {
            kind: application.discount.adjustment.kind,
            amount: getCanonicalMoney(application.discount.adjustment.amount),
          },
    expiresAt: application.discount.expiresAt ?? null,
    countdownStartsAt: application.discount.countdownStartsAt ?? null,
  },
  subtotalBefore: getCanonicalMoney(application.subtotalBefore),
  amount: getCanonicalMoney(application.amount),
  subtotalAfter: getCanonicalMoney(application.subtotalAfter),
});

const getCheckoutQuoteCanonicalPayload = (
  quote: Omit<WorkspaceCheckoutQuote, "fingerprint">
) => {
  const coffeePriceAmount = getWorkspaceProductCoffeeLinePriceForTier(
    quote.order.entryTier
  ).value;

  return JSON.stringify({
    schema: quote.schema,
    order: {
      tier: quote.order.entryTier,
      coffee: quote.order.coffee,
      coffeePriceAmount,
      monitorOption: quote.order.monitorOption ?? null,
    },
    currency: quote.summary.total.currency,
    exponent: quote.summary.total.exponent,
    payment: {
      expectedPrice: getCanonicalMoney(quote.payment.expectedPrice),
      undiscountedPrice: getCanonicalMoney(quote.payment.undiscountedPrice),
      discounts: quote.payment.discounts.map(getCanonicalAppliedDiscount),
    },
    sections: quote.summary.sections.map((section) => ({
      key: section.key,
      items: section.items.map(getCanonicalSummaryItem),
      total: section.total.value,
    })),
    total: quote.summary.total.value,
  });
};

export const getCheckoutQuoteFingerprint = (canonicalPayload: string) =>
  Array.from(canonicalPayload)
    .reduce(
      (hash, character) =>
        Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0,
      0x811c9dc5
    )
    .toString(16);

export const calculateWorkspaceCheckoutQuote = Effect.fn(
  "buildWorkspaceCheckoutQuote"
)(function* (
  order: WorkspaceCheckoutOrder,
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
  const orderItems: CheckoutSummaryItem[] = [
    {
      key: `product:${normalizedOrder.entryTier}`,
      amount: productPrice,
    },
  ];

  if (normalizedOrder.coffee) {
    orderItems.push({
      key: "addon:coffee",
      amount: coffeePrice,
    });
  }

  if (normalizedOrder.monitorOption) {
    orderItems.push({
      key: `monitor:${normalizedOrder.monitorOption}`,
      amount: workspaceMoneyWithValue(0, productPrice),
    });
  }

  const orderTotal = yield* addWorkspaceMoney(
    orderItems.map((item) => item.amount)
  );
  const discountQuote = options.discountQuote;

  if (
    discountQuote &&
    (discountQuote.product.kind !== "cowork" ||
      discountQuote.product.tier !== normalizedOrder.entryTier ||
      !workspaceMoneyEquals(discountQuote.discountableSubtotal, productPrice))
  ) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Discount quote does not match the checkout product.",
      })
    );
  }

  const discounts = discountQuote?.discounts ?? [];
  const discountedProductPrice =
    discountQuote?.discountedSubtotal ?? productPrice;
  const expectedPrice = yield* addWorkspaceMoney([
    discountedProductPrice,
    ...orderItems.slice(1).map(({ amount }) => amount),
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
    schema: "workspace-checkout-summary",
    sections,
    total: expectedPrice,
  };
  const quoteWithoutFingerprint = {
    schema: "workspace-checkout-quote" as const,
    order: normalizedOrder,
    summary,
    payment: {
      expectedPrice,
      undiscountedPrice: orderTotal,
      discounts,
    },
  };
  const canonicalFingerprintPayload = getCheckoutQuoteCanonicalPayload(
    quoteWithoutFingerprint
  );

  return {
    ...quoteWithoutFingerprint,
    fingerprint: getCheckoutQuoteFingerprint(canonicalFingerprintPayload),
  };
});

export const buildWorkspaceCheckoutQuote = (
  order: WorkspaceCheckoutOrder,
  options: {
    readonly discountQuote?: DiscountQuote;
    readonly currencyOverride?: string;
  } = {}
): WorkspaceCheckoutQuote =>
  Effect.runSync(calculateWorkspaceCheckoutQuote(order, options));

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
