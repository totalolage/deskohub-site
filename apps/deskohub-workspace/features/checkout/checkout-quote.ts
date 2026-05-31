import type { DotyposCustomerDiscount } from "@deskohub/dotypos";
import { applyWorkspaceCustomerDiscount } from "@/features/checkout/backend/checkout-pricing";
import {
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  type WorkspaceMoney,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
} from "@/features/checkout/product-catalog";

export const workspaceCheckoutQuoteSchemaVersion = 1 as const;

export type WorkspaceCheckoutOrder = {
  readonly entryTier: WorkspaceProductTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type CheckoutSummaryItem = {
  readonly key: string;
  readonly amount: WorkspaceMoney;
};

export type CheckoutSummarySection = {
  readonly key: "order" | "discount" | "total";
  readonly items: readonly CheckoutSummaryItem[];
  readonly total: WorkspaceMoney;
};

export type CheckoutSummary = {
  readonly schema: "workspace-checkout-summary";
  readonly schemaVersion: typeof workspaceCheckoutQuoteSchemaVersion;
  readonly sections: readonly CheckoutSummarySection[];
  readonly total: WorkspaceMoney;
};

export type WorkspaceCheckoutQuote = {
  readonly schema: "workspace-checkout-quote";
  readonly schemaVersion: typeof workspaceCheckoutQuoteSchemaVersion;
  readonly order: WorkspaceCheckoutOrder;
  readonly summary: CheckoutSummary;
  readonly fingerprint: string;
  readonly canonicalFingerprintPayload: string;
  readonly payment: {
    readonly expectedPrice: WorkspaceMoney;
    readonly undiscountedPrice?: WorkspaceMoney;
    readonly customerDiscount?: ReturnType<
      typeof applyWorkspaceCustomerDiscount
    >["customerDiscount"];
  };
};

export type CheckoutSummaryChangedKeys = {
  readonly sectionKeys: readonly string[];
  readonly itemKeys: readonly string[];
};

const withCurrency = (money: WorkspaceMoney, currency: string | undefined) => ({
  ...money,
  ...(currency && { currency }),
});

const money = (value: number, template: WorkspaceMoney): WorkspaceMoney => ({
  value,
  exponent: template.exponent,
  currency: template.currency,
});

const addMoney = (amounts: readonly WorkspaceMoney[]) => {
  const [first, ...rest] = amounts;
  if (!first) {
    throw new Error("Cannot total an empty list of workspace money amounts.");
  }

  return rest.reduce((total, amount) => {
    if (
      total.currency !== amount.currency ||
      total.exponent !== amount.exponent
    ) {
      throw new Error("Workspace quote cannot mix currencies or exponents.");
    }

    return money(total.value + amount.value, total);
  }, first);
};

export const normalizeWorkspaceCheckoutOrder = (
  order: WorkspaceCheckoutOrder
): WorkspaceCheckoutOrder => {
  const product = getWorkspaceProductByTier(order.entryTier);

  if (product.requiresMonitorOption && !order.monitorOption) {
    throw new Error("Monitor option is required for this entry tier.");
  }

  if (
    product.requiresMonitorOption &&
    order.monitorOption &&
    !product.allowedMonitorOptions.includes(order.monitorOption)
  ) {
    throw new Error("Monitor option is unavailable for this entry tier.");
  }

  if (!product.requiresMonitorOption && order.monitorOption) {
    throw new Error("Monitor option is unavailable for this entry tier.");
  }

  const normalizedOrder: WorkspaceCheckoutOrder = {
    entryTier: order.entryTier,
    coffee: product.requiresCoffee ? true : order.coffee,
    ...(order.monitorOption && { monitorOption: order.monitorOption }),
  };

  return normalizedOrder;
};

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount.value,
});

const getCheckoutQuoteCanonicalPayload = (
  quote: Omit<
    WorkspaceCheckoutQuote,
    "fingerprint" | "canonicalFingerprintPayload"
  >
) => {
  const product = getWorkspaceProductByTier(quote.order.entryTier);
  const coffeePriceAmount = getWorkspaceProductCoffeeLinePriceForTier(
    quote.order.entryTier
  ).value;

  return JSON.stringify({
    schema: quote.schema,
    schemaVersion: quote.schemaVersion,
    order: {
      tier: quote.order.entryTier,
      productCode: product.productCode,
      coffee: quote.order.coffee,
      coffeePriceAmount,
      monitorOption: quote.order.monitorOption ?? null,
    },
    currency: quote.summary.total.currency,
    exponent: quote.summary.total.exponent,
    payment: {
      expectedAmount: quote.payment.expectedPrice.value,
      undiscountedAmount: quote.payment.undiscountedPrice?.value ?? null,
      customerDiscount: quote.payment.customerDiscount
        ? {
            source: quote.payment.customerDiscount.source,
            field: quote.payment.customerDiscount.field,
            discountGroupId: quote.payment.customerDiscount.discountGroupId,
            percent: quote.payment.customerDiscount.percent,
            amount: quote.payment.customerDiscount.amount.value,
          }
        : null,
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

export const buildWorkspaceCheckoutQuote = (
  order: WorkspaceCheckoutOrder,
  options: {
    readonly customerDiscount?: DotyposCustomerDiscount;
    readonly currencyOverride?: string;
  } = {}
): WorkspaceCheckoutQuote => {
  const normalizedOrder = normalizeWorkspaceCheckoutOrder(order);
  const product = getWorkspaceProductByTier(normalizedOrder.entryTier);
  const productPrice = withCurrency(product.price, options.currencyOverride);
  const coffeePrice = withCurrency(
    getWorkspaceProductCoffeeLinePriceForTier(normalizedOrder.entryTier),
    options.currencyOverride
  );
  const orderItems: CheckoutSummaryItem[] = [
    {
      key: `product:${product.productCode}`,
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
      amount: money(0, productPrice),
    });
  }

  const orderTotal = addMoney(orderItems.map((item) => item.amount));
  const pricing = applyWorkspaceCustomerDiscount(
    orderTotal,
    options.customerDiscount
  );
  const orderSection: CheckoutSummarySection = {
    key: "order",
    items: orderItems,
    total: orderTotal,
  };
  const sections: CheckoutSummarySection[] = [orderSection];

  if (pricing.customerDiscount) {
    const discountAmount = money(
      -pricing.customerDiscount.amount.value,
      pricing.customerDiscount.amount
    );
    sections.push({
      key: "discount",
      items: [
        {
          key: `customer-discount:${pricing.customerDiscount.source}:${pricing.customerDiscount.discountGroupId}`,
          amount: discountAmount,
        },
      ],
      total: discountAmount,
    });
  }

  sections.push({
    key: "total",
    items: [
      {
        key: "total:final",
        amount: pricing.expectedPrice,
      },
    ],
    total: pricing.expectedPrice,
  });

  const summary: CheckoutSummary = {
    schema: "workspace-checkout-summary",
    schemaVersion: workspaceCheckoutQuoteSchemaVersion,
    sections,
    total: pricing.expectedPrice,
  };
  const quoteWithoutFingerprint = {
    schema: "workspace-checkout-quote" as const,
    schemaVersion: workspaceCheckoutQuoteSchemaVersion,
    order: normalizedOrder,
    summary,
    payment: {
      expectedPrice: pricing.expectedPrice,
      ...(pricing.customerDiscount && {
        undiscountedPrice: orderTotal,
        customerDiscount: pricing.customerDiscount,
      }),
    },
  };
  const canonicalFingerprintPayload = getCheckoutQuoteCanonicalPayload(
    quoteWithoutFingerprint
  );

  return {
    ...quoteWithoutFingerprint,
    canonicalFingerprintPayload,
    fingerprint: getCheckoutQuoteFingerprint(canonicalFingerprintPayload),
  };
};

const getSummarySectionMap = (summary: CheckoutSummary) =>
  new Map(summary.sections.map((section) => [section.key, section]));

const getSummaryItemMap = (summary: CheckoutSummary) =>
  new Map(
    summary.sections.flatMap((section) =>
      section.items.map((item) => [`${section.key}/${item.key}`, item] as const)
    )
  );

const moneyChanged = (previous?: WorkspaceMoney, next?: WorkspaceMoney) =>
  previous?.value !== next?.value ||
  previous?.currency !== next?.currency ||
  previous?.exponent !== next?.exponent;

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
      return moneyChanged(previousSection?.total, nextSection?.total);
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
      return moneyChanged(previousItem?.amount, nextItem?.amount);
    })
    .sort();

  return { sectionKeys, itemKeys };
};
