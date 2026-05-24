import { z } from "zod/v4";
import {
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import { locales } from "@/features/i18n";

const workspaceMoneySchema = z.object({
  value: z.int().nonnegative(),
  exponent: z.int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

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
    message: z.string().optional(),
  }),
  payment: z.object({
    expectedPrice: workspaceMoneySchema,
  }),
  legal: z.object({
    acceptedAt: z.iso.datetime({ offset: true }),
    documents: z.object({
      termsAndConditions: legalDocumentHashSchema,
      operatingRules: legalDocumentHashSchema,
      privacyPolicy: legalDocumentHashSchema,
    }),
    acknowledgements: z.object({
      operatingRules: z.literal(true),
      noRefundAfterPinDelivery: z.literal(true),
      privacyPolicy: z.literal(true),
    }),
  }),
  fulfillment: z.object({
    accessCodePolicy: z.literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJsonInput = z.input<
  typeof checkoutDetailsJsonSchema
>;
