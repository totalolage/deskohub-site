import { Schema } from "effect";
import { locales } from "@/features/i18n";
import { instantStringSchema } from "@/shared/utils/temporal";

const legalDocumentKeys = [
  "termsAndConditions",
  "operatingRules",
  "privacyPolicy",
  "marketingCommunications",
] as const;

export const legalEvidenceEventIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("LegalEvidenceEventId")
).annotate({
  identifier: "LegalEvidenceEventId",
  description: "Opaque identifier for a persisted legal evidence event.",
});

export type LegalEvidenceEventId = typeof legalEvidenceEventIdSchema.Type;

export const paymentSubmitLegalEvidenceSource = "payment_submit" as const;

/**
 * Customer acknowledgements captured with an accepted document. One
 * early-performance consent fact covers the combined early-performance request
 * and withdrawal-right acknowledgement behind the single checkout choice.
 * Checkout rejects payment when that consent is required but not given, so
 * the fact is only ever recorded as granted.
 */
const legalEvidenceAcknowledgementsSchema = Schema.Struct({
  earlyPerformanceConsent: Schema.optionalKey(Schema.Literal(true)),
}).annotate({
  identifier: "LegalEvidenceAcknowledgements",
  description:
    "Acknowledgements the customer gave together with an accepted legal document.",
});

export type LegalEvidenceAcknowledgements =
  typeof legalEvidenceAcknowledgementsSchema.Type;

const legalDocumentHashSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  hash: Schema.NonEmptyString,
  hashAlgorithm: Schema.Literal("sha256"),
});

export const legalEvidenceSchema = Schema.Struct({
  documentKey: Schema.Literals(legalDocumentKeys),
  documentHash: Schema.NonEmptyString,
  accepted: Schema.Boolean,
  acceptedAt: Schema.toEncoded(instantStringSchema),
  locale: Schema.Literals(locales),
  source: Schema.NonEmptyString,
  document: legalDocumentHashSchema,
  acknowledgements: Schema.optional(legalEvidenceAcknowledgementsSchema),
}).check(
  Schema.makeFilter(
    (evidence) => evidence.document.hash === evidence.documentHash,
    {
      path: ["documentHash"],
      message: "Legal evidence documentHash must match document.hash.",
    }
  )
);

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
