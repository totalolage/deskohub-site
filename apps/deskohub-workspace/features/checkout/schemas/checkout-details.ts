import { Data } from "effect";
import { z } from "zod/v4";
import {
  workspaceProductMonitorOptions,
  workspaceProductTiers,
} from "@/features/checkout/product-catalog";
import { checkoutSummarySectionSchema } from "@/features/checkout/schemas/checkout-summary";
import { nonNegativeWorkspaceMoneySchema } from "@/features/checkout/workspace-money";
import { locales } from "@/features/i18n";

export const legalDocumentKeys = [
  "termsAndConditions",
  "operatingRules",
  "privacyPolicy",
] as const;

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

export const legalEvidenceSources = [
  "reservation_submit",
  "payment_submit",
] as const;

export const reservationSubmitLegalEvidenceSource = legalEvidenceSources[0];
export const paymentSubmitLegalEvidenceSource = legalEvidenceSources[1];

export const legalDocumentHashSchema = z.object({
  path: z.string().min(1),
  hash: z.string().min(1),
  hashAlgorithm: z.literal("sha256"),
});

export type LegalDocumentHash = z.output<typeof legalDocumentHashSchema>;

export const legalEvidenceSchema = z
  .object({
    documentKey: z.enum(legalDocumentKeys),
    documentHash: z.string().min(1),
    accepted: z.boolean(),
    acceptedAt: z.iso.datetime({ offset: true }),
    locale: z.enum(locales),
    source: z.string().min(1),
    document: legalDocumentHashSchema,
    acknowledgements: z.record(z.string().min(1), z.boolean()).optional(),
  })
  .superRefine((evidence, ctx) => {
    if (evidence.document.hash !== evidence.documentHash) {
      ctx.addIssue({
        code: "custom",
        path: ["documentHash"],
        message: "Legal evidence documentHash must match document.hash.",
      });
    }
  });

export type LegalEvidence = z.output<typeof legalEvidenceSchema>;

export const legalEvidenceMapSchema = z
  .record(z.string().min(1), legalEvidenceSchema)
  .superRefine((evidenceMap, ctx) => {
    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        ctx.addIssue({
          code: "custom",
          path: [documentHash, "documentHash"],
          message: "Legal evidence map key must match evidence.documentHash.",
        });
      }
    }
  });

export type LegalEvidenceMap = z.output<typeof legalEvidenceMapSchema>;

export class CheckoutDetailsError extends Data.TaggedError(
  "CheckoutDetailsError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

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
    summary: z.object({
      sections: z.array(checkoutSummarySectionSchema),
      total: nonNegativeWorkspaceMoneySchema,
    }),
    providerRedirectUrl: z.url().optional(),
    customerDiscount: z
      .object({
        source: z.literal("dotypos-discount-group"),
        discountGroupId: z.string().min(1),
        percent: z.number().positive().max(100),
        amount: nonNegativeWorkspaceMoneySchema,
      })
      .optional(),
  }),
  legal: legalEvidenceMapSchema,
  fulfillment: z.object({
    accessCodePolicy: z.literal("workspace-static-v1"),
  }),
});

export type CheckoutDetailsJson = z.output<typeof checkoutDetailsJsonSchema>;
