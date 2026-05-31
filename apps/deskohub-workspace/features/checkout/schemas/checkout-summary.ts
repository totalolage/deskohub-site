import { z } from "zod/v4";

export const workspaceMoneySchema = z.object({
  value: z.int(),
  exponent: z.int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const nonNegativeWorkspaceMoneySchema = workspaceMoneySchema.extend({
  value: z.int().nonnegative(),
});

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
