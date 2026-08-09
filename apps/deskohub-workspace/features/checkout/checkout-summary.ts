import { Schema } from "effect";
import {
  coworkCheckoutSummaryDiscountedProductItemSchema,
  coworkCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-cowork-item";
import {
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-meeting-room-item";
import {
  officeCheckoutSummaryDiscountedProductItemSchema,
  officeCheckoutSummaryProductItemSchema,
} from "@/features/checkout/checkout-summary-office-item";
import {
  nonNegativeWorkspaceMoneyCodec,
  workspaceMoneyEquals,
} from "@/features/checkout/workspace-money";

export {
  type CheckoutSummaryDiscount,
  checkoutSummaryDiscountSchema,
} from "@/features/checkout/checkout-summary-product-item";

export const checkoutSummaryAddOnItemSchema = Schema.Struct({
  key: Schema.Union([
    Schema.Literal("addon:coffee"),
    Schema.TemplateLiteral(["monitor:", Schema.String]),
  ]),
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryOrderItemSchema = Schema.Union([
  meetingRoomCheckoutSummaryDiscountedProductItemSchema,
  meetingRoomCheckoutSummaryProductItemSchema,
  coworkCheckoutSummaryDiscountedProductItemSchema,
  coworkCheckoutSummaryProductItemSchema,
  officeCheckoutSummaryDiscountedProductItemSchema,
  officeCheckoutSummaryProductItemSchema,
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

export const checkoutSummaryChangedKeysSchema = Schema.Struct({
  sectionKeys: Schema.Array(Schema.String),
  itemKeys: Schema.Array(Schema.String),
});

export type CheckoutSummaryItem = typeof checkoutSummaryItemSchema.Type;
export type CheckoutSummaryOrderItem =
  typeof checkoutSummaryOrderItemSchema.Type;
export type CheckoutSummarySection = typeof checkoutSummarySectionSchema.Type;
export type CheckoutSummary = typeof checkoutSummarySchema.Type;
export type CheckoutSummaryChangedKeys =
  typeof checkoutSummaryChangedKeysSchema.Type;

const getCanonicalSummaryItem = (item: CheckoutSummaryItem) => ({
  key: item.key,
  amount: item.amount,
  ...("product" in item && { product: item.product }),
  ...("dayCount" in item && { dayCount: item.dayCount }),
  ...("seats" in item && { seats: item.seats }),
  ...("accessAmount" in item && { accessAmount: item.accessAmount }),
  ...("seatAmount" in item && { seatAmount: item.seatAmount }),
  ...("originalAmount" in item && {
    originalAmount: item.originalAmount,
    discounts: item.discounts,
  }),
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
