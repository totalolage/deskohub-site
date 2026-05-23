import { z } from "zod/v4";

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
  locale: z.enum(["cs-CZ", "en-US"]),
  reservation: z.object({
    tier: z.enum(["basic-day-pass", "cowork-plus", "profi-workstation"]),
    date: z.iso.date(),
    coffee: z.boolean(),
    monitorOption: z.enum(["2x27", "2x32", "qhd-4k"]).optional(),
    message: z.string().optional(),
  }),
  payment: z.object({
    expectedAmountMinor: z.int().nonnegative(),
    currency: z.literal("CZK"),
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
