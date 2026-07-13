import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { instantStringSchema } from "@/shared/utils/temporal";

export const legalDocumentKeys = [
  "termsAndConditions",
  "operatingRules",
  "privacyPolicy",
] as const;

export type LegalDocumentKey = (typeof legalDocumentKeys)[number];

export const reservationSubmitLegalEvidenceSource =
  "reservation_submit" as const;
export const paymentSubmitLegalEvidenceSource = "payment_submit" as const;

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
  Schema.makeFilter(
    (evidence) => evidence.document.hash === evidence.documentHash,
    {
      path: ["documentHash"],
      message: "Legal evidence documentHash must match document.hash.",
    }
  )
);

export type LegalEvidence = typeof legalEvidenceSchema.Type;

export const legalEvidenceMapSchema = Schema.Record(
  Schema.NonEmptyString,
  legalEvidenceSchema
).check(
  Schema.makeFilter((evidenceMap) => {
    const mismatchedEntry = Object.entries(evidenceMap).find(
      ([documentHash, evidence]) => documentHash !== evidence.documentHash
    );

    return mismatchedEntry
      ? {
          path: [mismatchedEntry[0], "documentHash"],
          issue: "Legal evidence map key must match evidence.documentHash.",
        }
      : undefined;
  })
);

export type LegalEvidenceMap = typeof legalEvidenceMapSchema.Type;
