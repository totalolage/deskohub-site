import { Schema } from "effect";
import type {
  CheckoutSummary,
  CheckoutSummaryItem,
  CheckoutSummarySection,
} from "@/features/checkout/checkout-quote";
import {
  nonNegativeWorkspaceMoneyCodec,
  workspaceMoneyCodec,
} from "@/features/checkout/workspace-money";

const nonEmptyStringSchema = Schema.String.check(Schema.isNonEmpty());

export const checkoutSummaryItemSchema: Schema.Codec<
  CheckoutSummaryItem,
  CheckoutSummaryItem
> = Schema.Struct({
  key: nonEmptyStringSchema,
  label: Schema.optional(nonEmptyStringSchema),
  amount: workspaceMoneyCodec,
});

const nonNegativeCheckoutSummaryItemSchema: Schema.Codec<
  CheckoutSummaryItem,
  CheckoutSummaryItem
> = Schema.Struct({
  key: nonEmptyStringSchema,
  label: Schema.optional(nonEmptyStringSchema),
  amount: nonNegativeWorkspaceMoneyCodec,
});

export const checkoutSummarySectionSchema: Schema.Codec<
  CheckoutSummarySection,
  CheckoutSummarySection
> = Schema.Union([
  Schema.Struct({
    key: Schema.Literal("order"),
    items: Schema.Array(nonNegativeCheckoutSummaryItemSchema),
    total: nonNegativeWorkspaceMoneyCodec,
  }),
  Schema.Struct({
    key: Schema.Literal("discount"),
    items: Schema.Array(
      Schema.Struct({
        key: nonEmptyStringSchema,
        label: nonEmptyStringSchema,
        amount: workspaceMoneyCodec,
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

export const checkoutSummarySchema: Schema.Codec<
  CheckoutSummary,
  CheckoutSummary
> = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-summary"),
  sections: Schema.Array(checkoutSummarySectionSchema),
  total: nonNegativeWorkspaceMoneyCodec,
}).annotate({
  identifier: "CheckoutSummary",
  description: "Public Workspace checkout summary snapshot.",
});
