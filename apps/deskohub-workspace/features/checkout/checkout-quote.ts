import type { DotyposCustomerDiscount } from "@deskohub/dotypos";
import { Data, Effect, Match } from "effect";
import { applyWorkspaceCustomerDiscount } from "@/features/checkout/backend/checkout/checkout-pricing";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  isWorkspaceMeetingRoomDuration,
  type WorkspaceCoworkProductTier,
  type WorkspaceMeetingRoomDurationMinutes,
  type WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import {
  addWorkspaceMoneyEffect,
  type WorkspaceMoney,
  withWorkspaceMoneyCurrency,
  workspaceMoneyEquals,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import {
  getReservationDurationMinutes,
  isDefaultReservationInterval,
  normalizeReservationInterval,
  type ReservationInterval,
  unsafeNormalizeReservationInterval,
} from "@/features/reservation/schemas/reservation-interval";
import { getReservationProductRuleIssue } from "@/features/reservation/schemas/reservation-product-rules";

export const workspaceCheckoutQuoteSchemaVersion = 1 as const;

export type WorkspaceCoworkCheckoutOrder = {
  readonly entryTier: WorkspaceCoworkProductTier;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
} & Partial<ReservationInterval>;

export type WorkspaceMeetingRoomCheckoutOrder = {
  readonly entryTier: "meeting-room";
} & ReservationInterval;

export type WorkspaceCheckoutOrder =
  | WorkspaceCoworkCheckoutOrder
  | WorkspaceMeetingRoomCheckoutOrder;

export type CheckoutSummaryItem = {
  readonly key: string;
  readonly amount: WorkspaceMoney;
  readonly meetingRoomDurationMinutes?: WorkspaceMeetingRoomDurationMinutes;
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

export class CheckoutQuoteError extends Data.TaggedError("CheckoutQuoteError")<{
  readonly message: string;
}> {}

export const normalizeWorkspaceCheckoutOrderEffect = Effect.fn(
  "normalizeWorkspaceCheckoutOrder"
)(function* (order: WorkspaceCheckoutOrder) {
  const product = getWorkspaceProductByTier(order.entryTier);
  const interval = yield* normalizeReservationInterval(order).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutQuoteError({
          message: cause.message,
        })
    )
  );

  const monitorOption = Match.value(order).pipe(
    Match.when({ entryTier: "meeting-room" }, () => undefined),
    Match.orElse((coworkOrder) => coworkOrder.monitorOption)
  );

  if (product.requiresMonitorOption && !monitorOption) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is required for this entry tier.",
      })
    );
  }

  if (
    product.requiresMonitorOption &&
    monitorOption &&
    !product.allowedMonitorOptions.includes(monitorOption)
  ) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is unavailable for this entry tier.",
      })
    );
  }

  if (!product.requiresMonitorOption && monitorOption) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: "Monitor option is unavailable for this entry tier.",
      })
    );
  }

  const productRuleIssue = getReservationProductRuleIssue({
    ...order,
    startsAt: interval.startsAt,
    endsAt: interval.endsAt,
  });
  if (productRuleIssue) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: productRuleIssue.message,
      })
    );
  }

  const normalizedOrder: WorkspaceCheckoutOrder = Match.value(order).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomOrder) => ({
      entryTier: meetingRoomOrder.entryTier,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
    })),
    Match.orElse((coworkOrder) => ({
      entryTier: coworkOrder.entryTier,
      coffee: product.requiresCoffee ? true : coworkOrder.coffee,
      ...(!isDefaultReservationInterval(interval) && {
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
      }),
      ...(monitorOption && { monitorOption }),
    }))
  );

  return normalizedOrder;
});

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount.value,
});

const getCheckoutQuoteCanonicalPayload = (
  quote: Omit<WorkspaceCheckoutQuote, "fingerprint">
) => {
  const interval = unsafeNormalizeReservationInterval(quote.order);
  const order = Match.value(quote.order).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomOrder) => ({
      tier: meetingRoomOrder.entryTier,
      interval,
    })),
    Match.orElse((coworkOrder) => ({
      tier: coworkOrder.entryTier,
      coffee: coworkOrder.coffee,
      coffeePriceAmount: getWorkspaceProductCoffeeLinePriceForTier(
        coworkOrder.entryTier
      ).value,
      monitorOption: coworkOrder.monitorOption ?? null,
      ...(!isDefaultReservationInterval(interval) && { interval }),
    }))
  );

  return JSON.stringify({
    schema: quote.schema,
    schemaVersion: quote.schemaVersion,
    order,
    currency: quote.summary.total.currency,
    exponent: quote.summary.total.exponent,
    payment: {
      expectedAmount: quote.payment.expectedPrice.value,
      undiscountedAmount: quote.payment.undiscountedPrice?.value ?? null,
      customerDiscount: quote.payment.customerDiscount
        ? {
            source: quote.payment.customerDiscount.source,
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

export const buildWorkspaceCheckoutQuoteEffect = Effect.fn(
  "buildWorkspaceCheckoutQuote"
)(function* (
  order: WorkspaceCheckoutOrder,
  options: {
    readonly customerDiscount?: DotyposCustomerDiscount;
    readonly currencyOverride?: string;
  } = {}
) {
  const normalizedOrder = yield* normalizeWorkspaceCheckoutOrderEffect(order);
  const product = getWorkspaceProductByTier(normalizedOrder.entryTier);
  const interval = unsafeNormalizeReservationInterval(normalizedOrder);
  const durationMinutes = getReservationDurationMinutes(interval);
  const productPrice = withWorkspaceMoneyCurrency(
    Match.value(normalizedOrder).pipe(
      Match.when({ entryTier: "meeting-room" }, () =>
        isWorkspaceMeetingRoomDuration(durationMinutes)
          ? getWorkspaceMeetingRoomPriceForDuration(durationMinutes)
          : product.price
      ),
      Match.orElse(() => product.price)
    ),
    options.currencyOverride
  );
  const coffeePrice = withWorkspaceMoneyCurrency(
    getWorkspaceProductCoffeeLinePriceForTier(normalizedOrder.entryTier),
    options.currencyOverride
  );
  const orderItems: CheckoutSummaryItem[] = [
    {
      key: Match.value(normalizedOrder).pipe(
        Match.when(
          { entryTier: "meeting-room" },
          () => `product:meeting-room:${durationMinutes}`
        ),
        Match.orElse((coworkOrder) => `product:${coworkOrder.entryTier}`)
      ),
      amount: productPrice,
      ...Match.value(normalizedOrder).pipe(
        Match.when({ entryTier: "meeting-room" }, () =>
          isWorkspaceMeetingRoomDuration(durationMinutes)
            ? { meetingRoomDurationMinutes: durationMinutes }
            : {}
        ),
        Match.orElse(() => ({}))
      ),
    },
  ];

  if (normalizedOrder.entryTier !== "meeting-room" && normalizedOrder.coffee) {
    orderItems.push({
      key: "addon:coffee",
      amount: coffeePrice,
    });
  }

  if (
    normalizedOrder.entryTier !== "meeting-room" &&
    normalizedOrder.monitorOption
  ) {
    orderItems.push({
      key: `monitor:${normalizedOrder.monitorOption}`,
      amount: workspaceMoneyWithValue(0, productPrice),
    });
  }

  const orderTotal = yield* addWorkspaceMoneyEffect(
    orderItems.map((item) => item.amount)
  );
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
    const discountAmount = workspaceMoneyWithValue(
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
    fingerprint: getCheckoutQuoteFingerprint(canonicalFingerprintPayload),
  };
});

export const buildWorkspaceCheckoutQuote = (
  order: WorkspaceCheckoutOrder,
  options: {
    readonly customerDiscount?: DotyposCustomerDiscount;
    readonly currencyOverride?: string;
  } = {}
): WorkspaceCheckoutQuote =>
  Effect.runSync(buildWorkspaceCheckoutQuoteEffect(order, options));

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
      return !workspaceMoneyEquals(previousItem?.amount, nextItem?.amount);
    })
    .sort();

  return { sectionKeys, itemKeys };
};
