import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { isoDateTimeWithOffsetStringEffectSchema } from "@/shared/utils/effect-schema";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";

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

export const legalDocumentHashEffectSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  hash: Schema.NonEmptyString,
  hashAlgorithm: Schema.Literal("sha256"),
});

export type LegalDocumentHash = typeof legalDocumentHashEffectSchema.Type;

export const legalDocumentHashSchema = makeEffectSchemaParser(
  legalDocumentHashEffectSchema
);

export const legalEvidenceEffectSchema = Schema.Struct({
  documentKey: Schema.Literals(legalDocumentKeys),
  documentHash: Schema.NonEmptyString,
  accepted: Schema.Boolean,
  acceptedAt: isoDateTimeWithOffsetStringEffectSchema,
  locale: Schema.Literals(locales),
  source: Schema.NonEmptyString,
  document: legalDocumentHashEffectSchema,
  acknowledgements: Schema.optional(
    Schema.Record(Schema.NonEmptyString, Schema.Boolean)
  ),
}).check(
  Schema.makeFilter((evidence) => {
    if (evidence.document.hash !== evidence.documentHash) {
      return {
        path: ["documentHash"],
        issue: "Legal evidence documentHash must match document.hash.",
      };
    }

    return undefined;
  })
);

export type LegalEvidence = typeof legalEvidenceEffectSchema.Type;

export const legalEvidenceSchema = makeEffectSchemaParser(
  legalEvidenceEffectSchema
);

export const legalEvidenceMapEffectSchema = Schema.Record(
  Schema.NonEmptyString,
  legalEvidenceEffectSchema
).check(
  Schema.makeFilter((evidenceMap) => {
    const issues = [];

    for (const [documentHash, evidence] of Object.entries(evidenceMap)) {
      if (documentHash !== evidence.documentHash) {
        issues.push({
          path: [documentHash, "documentHash"],
          issue: "Legal evidence map key must match evidence.documentHash.",
        });
      }
    }

    return issues;
  })
);

export type LegalEvidenceMap = typeof legalEvidenceMapEffectSchema.Type;

export const legalEvidenceMapSchema = makeEffectSchemaParser(
  legalEvidenceMapEffectSchema
);
