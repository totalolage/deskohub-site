import { z } from "zod/v4";
import {
  nonNegativeWorkspaceMoneySchema,
  workspaceMoneySchema,
} from "@/features/checkout/workspace-money";

export const checkoutSummaryItemSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1).optional(),
    amount: workspaceMoneySchema,
  })
  .strict();

export const checkoutSummarySectionSchema = z.discriminatedUnion("key", [
  z
    .object({
      key: z.literal("order"),
      items: z.array(
        checkoutSummaryItemSchema.extend({
          amount: nonNegativeWorkspaceMoneySchema,
        })
      ),
      total: nonNegativeWorkspaceMoneySchema,
    })
    .strict(),
  z
    .object({
      key: z.literal("discount"),
      items: z.array(
        checkoutSummaryItemSchema.extend({ label: z.string().min(1) }).strict()
      ),
      total: workspaceMoneySchema,
    })
    .strict(),
  z
    .object({
      key: z.literal("total"),
      items: z.array(
        checkoutSummaryItemSchema.extend({
          amount: nonNegativeWorkspaceMoneySchema,
        })
      ),
      total: nonNegativeWorkspaceMoneySchema,
    })
    .strict(),
]);

export const checkoutSummarySchema = z
  .object({
    schema: z.literal("workspace-checkout-summary"),
    sections: z.array(checkoutSummarySectionSchema),
    total: nonNegativeWorkspaceMoneySchema,
  })
  .strict();
