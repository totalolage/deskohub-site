import { z } from "zod/v4";
import {
  nonNegativeWorkspaceMoneySchema,
  workspaceMoneySchema,
} from "@/features/checkout/workspace-money";

export const checkoutSummaryItemSchema = z.object({
  key: z.string().min(1),
  amount: workspaceMoneySchema,
});

export const checkoutSummarySectionSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("order"),
    items: z.array(
      checkoutSummaryItemSchema.extend({
        amount: nonNegativeWorkspaceMoneySchema,
      })
    ),
    total: nonNegativeWorkspaceMoneySchema,
  }),
  z.object({
    key: z.literal("discount"),
    items: z.array(checkoutSummaryItemSchema),
    total: workspaceMoneySchema,
  }),
  z.object({
    key: z.literal("total"),
    items: z.array(
      checkoutSummaryItemSchema.extend({
        amount: nonNegativeWorkspaceMoneySchema,
      })
    ),
    total: nonNegativeWorkspaceMoneySchema,
  }),
]);

export const checkoutSummarySchema = z.object({
  schema: z.literal("workspace-checkout-summary"),
  schemaVersion: z.literal(1),
  sections: z.array(checkoutSummarySectionSchema),
  total: nonNegativeWorkspaceMoneySchema,
});
