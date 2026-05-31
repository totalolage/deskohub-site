import { z } from "zod/v4";
import {
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import {
  checkoutSummarySectionSchema,
  nonNegativeWorkspaceMoneySchema,
} from "@/features/checkout/schemas/checkout-summary";
import { locales } from "@/features/i18n";

export const legalDocumentHashSchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
  hashAlgorithm: z.literal("sha256"),
});

// This JSON is intentionally limited to booking, payment, legal, and fulfillment
// state. Customer name, email, and phone remain owned by Dotypos and must not be
// added here or as local database columns.
export const checkoutDetailsJsonSchema = z.object({
  schema: z.literal("workspace-checkout-details"),
  schemaVersion: z.literal(1),
  locale: z.enum(locales),
  reservation: z.object({
    tier: z.enum(workspaceProductTiers),
    date: z.iso.date(),
    coffee: z.boolean(),
    monitorOption: z.enum(workspaceProductMonitorOptions).optional(),
  }),
  payment: z.object({
    expectedPrice: nonNegativeWorkspaceMoneySchema,
    undiscountedPrice: nonNegativeWorkspaceMoneySchema.optional(),
    quoteFingerprint: z.string().min(1),
    summary: z.object({
      sections: z.array(checkoutSummarySectionSchema),
      total: nonNegativeWorkspaceMoneySchema,
    }),
    providerRedirectUrl: z.url().optional(),
    customerDiscount: z
      .object({
        source: z.literal("dotypos-discount-group"),
        field: z.string().min(1),
        discountGroupId: z.string().min(1),
        percent: z.number().positive().max(100),
        amount: nonNegativeWorkspaceMoneySchema,
      })
      .optional(),
  }),
  legal: z.object({
    acceptedAt: z.iso.datetime({ offset: true }),
    locale: z.enum(locales),
    source: z.literal("workspace-pay-final-submit"),
    documents: z.object({
      termsAndConditions: legalDocumentHashSchema,
      operatingRules: legalDocumentHashSchema,
      privacyPolicy: legalDocumentHashSchema,
    }),
    acknowledgements: z.object({
      termsAndConditions: z.boolean(),
      operatingRules: z.boolean(),
      noRefundAfterPinDelivery: z.boolean(),
      privacyPolicy: z.boolean(),
    }),
  }),
  fulfillment: z.object({
    accessCodePolicy: z.literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJsonInput = z.input<
  typeof checkoutDetailsJsonSchema
>;
