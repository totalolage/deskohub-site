import { Schema } from "effect";
import { checkoutSummarySchema } from "@/features/checkout/checkout-quote";
import { nonNegativeWorkspaceMoneyCodec } from "@/features/checkout/workspace-money";
import { appliedDiscountCodec } from "@/features/discounts/contracts";
import { locales } from "@/features/i18n";
import { coworkReservationDetailsSchema } from "@/features/reservation/cowork-reservation";
import { instantStringSchema } from "@/shared/utils/temporal";

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

export const legalDocumentHashSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  hash: Schema.NonEmptyString,
  hashAlgorithm: Schema.Literal("sha256"),
});

export type LegalDocumentHash = typeof legalDocumentHashSchema.Type;

export const legalEvidenceSchema = Schema.Struct({
  documentKey: Schema.Literals(legalDocumentKeys),
  documentHash: Schema.NonEmptyString,
  accepted: Schema.Boolean,
  acceptedAt: Schema.toEncoded(instantStringSchema),
  locale: Schema.Literals(locales),
  source: Schema.NonEmptyString,
  document: legalDocumentHashSchema,
  acknowledgements: Schema.optional(
    Schema.Record(Schema.NonEmptyString, Schema.Boolean)
  ),
}).check(
  Schema.makeFilter((evidence) =>
    evidence.document.hash === evidence.documentHash
      ? true
      : {
          path: ["documentHash"],
          issue: "Legal evidence documentHash must match document.hash.",
        }
  )
);

export type LegalEvidence = typeof legalEvidenceSchema.Type;

export const legalEvidenceMapSchema = Schema.Record(
  Schema.NonEmptyString,
  legalEvidenceSchema
).check(
  Schema.makeFilter((evidenceMap) => {
    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        return {
          path: [documentHash, "documentHash"],
          issue: "Legal evidence map key must match evidence.documentHash.",
        };
      }
    }

    return true;
  })
);

export type LegalEvidenceMap = typeof legalEvidenceMapSchema.Type;

// This transient snapshot contains only the booking, payment, and legal data
// required by provider adapters. Customer contact remains owned by Dotypos.
export const checkoutDetailsJsonSchema = Schema.Struct({
  schema: Schema.Literal("workspace-checkout-details"),
  schemaVersion: Schema.Literal(1),
  locale: Schema.Literals(locales),
  reservation: coworkReservationDetailsSchema,
  payment: Schema.Struct({
    expectedPrice: nonNegativeWorkspaceMoneyCodec,
    undiscountedPrice: nonNegativeWorkspaceMoneyCodec,
    discounts: Schema.Array(appliedDiscountCodec),
    summary: checkoutSummarySchema,
    providerRedirectUrl: Schema.optional(Schema.URL),
  }),
  legal: legalEvidenceMapSchema,
}).annotate({
  identifier: "CheckoutDetails",
  description: "Transient PII-free checkout provider snapshot.",
});

export type CheckoutDetailsJson = typeof checkoutDetailsJsonSchema.Type;
