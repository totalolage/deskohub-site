import type { DotyposCustomerDiscount } from "@deskohub/dotypos";
import { Data, Effect, Match } from "effect";
import { applyWorkspaceCustomerDiscount } from "@/features/checkout/backend/checkout/checkout-pricing";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  getWorkspaceProductByTier,
  getWorkspaceProductCoffeeLinePriceForTier,
  isWorkspaceMeetingRoomDuration,
} from "@/features/checkout/product-catalog";
import type {
  CheckoutSummary,
  CheckoutSummaryItem,
  CheckoutSummarySection,
} from "@/features/checkout/schemas/checkout-summary";
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
import type {
  StoredBasicReservationDetails,
  StoredCoworkReservationDetails,
  StoredMeetingRoomReservationDetails,
  StoredPlusReservationDetails,
  StoredProfiReservationDetails,
} from "@/features/reservation/schemas/stored-reservation-details";

export const workspaceCheckoutQuoteSchemaVersion = 1 as const;

export type {
  CheckoutSummary,
  CheckoutSummaryItem,
  CheckoutSummarySection,
} from "@/features/checkout/schemas/checkout-summary";

export type WorkspaceBasicCheckoutOrder = StoredBasicReservationDetails &
  Partial<ReservationInterval>;

export type WorkspacePlusCheckoutOrder = StoredPlusReservationDetails &
  Partial<ReservationInterval>;

export type WorkspaceProfiCheckoutOrder = StoredProfiReservationDetails &
  Partial<ReservationInterval>;

export type WorkspaceCoworkCheckoutOrder = StoredCoworkReservationDetails &
  Partial<ReservationInterval>;

export type WorkspaceMeetingRoomCheckoutOrder =
  StoredMeetingRoomReservationDetails & ReservationInterval;

export type WorkspaceCheckoutOrder =
  | WorkspaceCoworkCheckoutOrder
  | WorkspaceMeetingRoomCheckoutOrder;

export type WorkspaceBasicCheckoutOrderInput = {
  readonly entryTier: StoredBasicReservationDetails["tier"];
  readonly coffee: StoredBasicReservationDetails["coffee"];
  readonly monitorOption?: never;
} & Partial<ReservationInterval>;

export type WorkspacePlusCheckoutOrderInput = {
  readonly entryTier: StoredPlusReservationDetails["tier"];
  readonly coffee: StoredPlusReservationDetails["coffee"];
  readonly monitorOption?: never;
} & Partial<ReservationInterval>;

export type WorkspaceProfiCheckoutOrderInput = {
  readonly entryTier: StoredProfiReservationDetails["tier"];
  readonly coffee: StoredProfiReservationDetails["coffee"];
  readonly monitorOption: StoredProfiReservationDetails["monitorOption"];
} & Partial<ReservationInterval>;

export type WorkspaceMeetingRoomCheckoutOrderInput = {
  readonly entryTier: StoredMeetingRoomReservationDetails["_tag"];
  readonly coffee?: never;
  readonly monitorOption?: never;
} & ReservationInterval;

export type WorkspaceCheckoutOrderInput =
  | WorkspaceBasicCheckoutOrderInput
  | WorkspacePlusCheckoutOrderInput
  | WorkspaceProfiCheckoutOrderInput
  | WorkspaceMeetingRoomCheckoutOrderInput;

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

const toWorkspaceCheckoutOrder = (
  order: WorkspaceCheckoutOrderInput
): WorkspaceCheckoutOrder =>
  Match.value(order).pipe(
    Match.when({ entryTier: "meeting-room" }, (meetingRoomOrder) => ({
      _tag: "meeting-room" as const,
      startsAt: meetingRoomOrder.startsAt,
      endsAt: meetingRoomOrder.endsAt,
    })),
    Match.when({ entryTier: "basic" }, (basicOrder) => ({
      _tag: "cowork" as const,
      tier: "basic" as const,
      coffee: basicOrder.coffee,
      ...("startsAt" in basicOrder &&
        basicOrder.startsAt && { startsAt: basicOrder.startsAt }),
      ...("endsAt" in basicOrder &&
        basicOrder.endsAt && { endsAt: basicOrder.endsAt }),
    })),
    Match.when({ entryTier: "plus" }, (plusOrder) => ({
      _tag: "cowork" as const,
      tier: "plus" as const,
      coffee: true as const,
      ...("startsAt" in plusOrder &&
        plusOrder.startsAt && { startsAt: plusOrder.startsAt }),
      ...("endsAt" in plusOrder &&
        plusOrder.endsAt && { endsAt: plusOrder.endsAt }),
    })),
    Match.when({ entryTier: "profi" }, (profiOrder) => ({
      _tag: "cowork" as const,
      tier: "profi" as const,
      coffee: true as const,
      ...("startsAt" in profiOrder &&
        profiOrder.startsAt && { startsAt: profiOrder.startsAt }),
      ...("endsAt" in profiOrder &&
        profiOrder.endsAt && { endsAt: profiOrder.endsAt }),
      monitorOption: profiOrder.monitorOption,
    })),
    Match.exhaustive
  );

const getReservationProductRuleInput = (
  order: WorkspaceCheckoutOrder,
  interval: ReservationInterval
) =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => ({
      _tag: "meeting-room" as const,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
    })),
    Match.tag("cowork", (coworkOrder) => ({
      _tag: "cowork" as const,
      tier: coworkOrder.tier,
      coffee: coworkOrder.coffee,
      ...("monitorOption" in coworkOrder && {
        monitorOption: coworkOrder.monitorOption,
      }),
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
    })),
    Match.exhaustive
  );

export const normalizeWorkspaceCheckoutOrderEffect = Effect.fn(
  "normalizeWorkspaceCheckoutOrder"
)(function* (input: WorkspaceCheckoutOrderInput) {
  const order = toWorkspaceCheckoutOrder(input);
  const interval = yield* normalizeReservationInterval(order).pipe(
    Effect.mapError(
      (cause) =>
        new CheckoutQuoteError({
          message: cause.message,
        })
    )
  );

  const productRuleIssue = getReservationProductRuleIssue(
    getReservationProductRuleInput(order, interval)
  );
  if (productRuleIssue) {
    return yield* Effect.fail(
      new CheckoutQuoteError({
        message: productRuleIssue.message,
      })
    );
  }

  const normalizedOrder: WorkspaceCheckoutOrder = Match.value(order).pipe(
    Match.tag("meeting-room", () => ({
      _tag: "meeting-room" as const,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
    })),
    Match.tag("cowork", (coworkOrder) =>
      Match.value(coworkOrder).pipe(
        Match.when({ tier: "basic" }, (basicOrder) => ({
          _tag: "cowork" as const,
          tier: "basic" as const,
          coffee: basicOrder.coffee,
          ...(!isDefaultReservationInterval(interval) && {
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
          }),
        })),
        Match.when({ tier: "plus" }, () => ({
          _tag: "cowork" as const,
          tier: "plus" as const,
          coffee: true as const,
          ...(!isDefaultReservationInterval(interval) && {
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
          }),
        })),
        Match.when({ tier: "profi" }, (profiOrder) => ({
          _tag: "cowork" as const,
          tier: "profi" as const,
          coffee: true as const,
          ...(!isDefaultReservationInterval(interval) && {
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
          }),
          monitorOption: profiOrder.monitorOption,
        })),
        Match.exhaustive
      )
    ),
    Match.exhaustive
  );

  return normalizedOrder;
});

const getWorkspaceCheckoutOrderProductPrice = (
  order: WorkspaceCheckoutOrder,
  durationMinutes: number
) =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => {
      if (isWorkspaceMeetingRoomDuration(durationMinutes)) {
        return getWorkspaceMeetingRoomPriceForDuration(durationMinutes);
      }

      throw new Error(
        "Meeting room checkout pricing requires an approved duration."
      );
    }),
    Match.tag(
      "cowork",
      (coworkOrder) => getWorkspaceProductByTier(coworkOrder.tier).price
    ),
    Match.exhaustive
  );

const getWorkspaceCheckoutOrderCoffeePrice = (
  order: WorkspaceCheckoutOrder,
  productPrice: WorkspaceMoney
) =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => workspaceMoneyWithValue(0, productPrice)),
    Match.tag("cowork", (coworkOrder) =>
      getWorkspaceProductCoffeeLinePriceForTier(coworkOrder.tier)
    ),
    Match.exhaustive
  );

const getWorkspaceCheckoutOrderProductItem = (
  order: WorkspaceCheckoutOrder,
  productPrice: CheckoutSummaryItem["amount"],
  durationMinutes: number
): CheckoutSummaryItem =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => ({
      key: "product:meeting-room",
      amount: productPrice,
      ...(isWorkspaceMeetingRoomDuration(durationMinutes) && {
        meetingRoomDurationMinutes: durationMinutes,
      }),
    })),
    Match.tag("cowork", (coworkOrder) => ({
      key: `product:${coworkOrder.tier}`,
      amount: productPrice,
    })),
    Match.exhaustive
  );

const getWorkspaceCheckoutOrderAddons = (
  order: WorkspaceCheckoutOrder,
  coffeePrice: CheckoutSummaryItem["amount"],
  productPrice: CheckoutSummaryItem["amount"]
): CheckoutSummaryItem[] =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => []),
    Match.tag("cowork", (coworkOrder) => {
      const items: CheckoutSummaryItem[] = [];

      if (coworkOrder.coffee) {
        items.push({
          key: "addon:coffee",
          amount: coffeePrice,
        });
      }

      if ("monitorOption" in coworkOrder) {
        items.push({
          key: `monitor:${coworkOrder.monitorOption}`,
          amount: workspaceMoneyWithValue(0, productPrice),
        });
      }

      return items;
    }),
    Match.exhaustive
  );

const getCanonicalCheckoutOrder = (
  order: WorkspaceCheckoutOrder,
  interval: ReservationInterval
) =>
  Match.value(order).pipe(
    Match.tag("meeting-room", () => ({
      _tag: "meeting-room" as const,
      interval,
    })),
    Match.tag("cowork", (coworkOrder) => {
      return {
        _tag: "cowork" as const,
        tier: coworkOrder.tier,
        coffee: coworkOrder.coffee,
        coffeePriceAmount: getWorkspaceProductCoffeeLinePriceForTier(
          coworkOrder.tier
        ).value,
        monitorOption:
          "monitorOption" in coworkOrder ? coworkOrder.monitorOption : null,
        ...(!isDefaultReservationInterval(interval) && {
          interval,
        }),
      };
    }),
    Match.exhaustive
  );

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount.value,
  meetingRoomDurationMinutes: item.meetingRoomDurationMinutes ?? null,
});

const getCheckoutQuoteCanonicalPayload = (
  quote: Omit<WorkspaceCheckoutQuote, "fingerprint">
) => {
  const interval = unsafeNormalizeReservationInterval(quote.order);
  const order = getCanonicalCheckoutOrder(quote.order, interval);

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
  order: WorkspaceCheckoutOrderInput,
  options: {
    readonly customerDiscount?: DotyposCustomerDiscount;
    readonly currencyOverride?: string;
  } = {}
) {
  const normalizedOrder = yield* normalizeWorkspaceCheckoutOrderEffect(order);
  const interval = unsafeNormalizeReservationInterval(normalizedOrder);
  const durationMinutes = getReservationDurationMinutes(interval);
  const productPrice = withWorkspaceMoneyCurrency(
    getWorkspaceCheckoutOrderProductPrice(normalizedOrder, durationMinutes),
    options.currencyOverride
  );
  const coffeePrice = withWorkspaceMoneyCurrency(
    getWorkspaceCheckoutOrderCoffeePrice(normalizedOrder, productPrice),
    options.currencyOverride
  );
  const orderItems: CheckoutSummaryItem[] = [
    getWorkspaceCheckoutOrderProductItem(
      normalizedOrder,
      productPrice,
      durationMinutes
    ),
    ...getWorkspaceCheckoutOrderAddons(
      normalizedOrder,
      coffeePrice,
      productPrice
    ),
  ];

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
  order: WorkspaceCheckoutOrderInput,
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
