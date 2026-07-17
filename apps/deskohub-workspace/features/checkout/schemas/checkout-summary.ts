import { Schema } from "effect";
import {
  nonNegativeWorkspaceMoneyCodec,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

export const checkoutSummaryItemSchema = Schema.Struct({
  key: nonEmptyStringSchema,
  label: Schema.optional(nonEmptyStringSchema),
  amount: workspaceMoneyCodec,
});

const nonNegativeCheckoutSummaryItemSchema = Schema.Struct({
  key: nonEmptyStringSchema,
  label: Schema.optional(nonEmptyStringSchema),
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryOrderSectionSchema = Schema.Struct({
  key: Schema.Literal("order"),
  items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
  total: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummaryDiscountSectionSchema = Schema.Struct({
  key: Schema.Literal("discount"),
  items: Schema.Array(
    Schema.Struct({
      key: nonEmptyStringSchema,
      label: nonEmptyStringSchema,
      amount: workspaceMoneyCodec,
    })
  ),
  total: workspaceMoneyCodec,
});

export const checkoutSummaryTotalSectionSchema = Schema.Struct({
  key: Schema.Literal("total"),
  items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
  total: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummarySectionSchema = Schema.Union([
  checkoutSummaryOrderSectionSchema,
  checkoutSummaryDiscountSectionSchema,
  checkoutSummaryTotalSectionSchema,
]);

export const checkoutSummarySchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-summary"),
  sections: Schema.Array(checkoutSummarySectionSchema),
  total: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "CheckoutSummary",
  description: "Public Workspace checkout summary snapshot.",
});

export type CheckoutSummaryItem = typeof checkoutSummaryItemSchema.Type;
export type CheckoutSummarySection = typeof checkoutSummarySectionSchema.Type;
export type CheckoutSummary = typeof checkoutSummarySchema.Type;
