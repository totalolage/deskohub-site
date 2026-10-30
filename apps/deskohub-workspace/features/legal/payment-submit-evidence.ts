import { Schema } from "effect";
import {
  type LegalEvidenceMap,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import type { Locale } from "@/features/i18n";
import {
  getLegalDocumentPath,
  getLegalDocumentVersion,
  legalDocumentHashAlgorithm,
} from "./document-version";
import type { LegalDocumentKey } from "./legal-document-summaries";

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  { onExcessProperty: "error" }
);

const getAcceptedDocument = (
  locale: Locale,
  documentKey: LegalDocumentKey
) => ({
  path: getLegalDocumentPath(locale, documentKey),
  hash: getLegalDocumentVersion(locale, documentKey),
  hashAlgorithm: legalDocumentHashAlgorithm,
});

/**
 * The legal evidence a payment submission records: acceptance of the terms
 * and conditions and of the operating rules. Each record keeps the
 * `document_key` value already stored in `legal_evidence_events`, which is
 * camelCase while the documents' own keys are kebab-case.
 */
export const getPaymentSubmitLegalEvidence = (input: {
  readonly locale: Locale;
  readonly acceptedAt: string;
  /**
   * Whether checkout required, and so received, the customer's
   * early-performance consent. Checkout makes that decision; the terms record
   * only carries it.
   */
  readonly earlyPerformanceConsent: boolean;
}): LegalEvidenceMap => {
  const termsAndConditions = getAcceptedDocument(
    input.locale,
    "terms-and-conditions"
  );
  const operatingRules = getAcceptedDocument(input.locale, "operating-rules");

  return decodeLegalEvidenceMap({
    [termsAndConditions.hash]: {
      documentKey: "termsAndConditions",
      documentHash: termsAndConditions.hash,
      accepted: true,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: paymentSubmitLegalEvidenceSource,
      document: termsAndConditions,
      acknowledgements: input.earlyPerformanceConsent
        ? {
            earlyPerformanceConsent: true,
          }
        : undefined,
    },
    [operatingRules.hash]: {
      documentKey: "operatingRules",
      documentHash: operatingRules.hash,
      accepted: true,
      acceptedAt: input.acceptedAt,
      locale: input.locale,
      source: paymentSubmitLegalEvidenceSource,
      document: operatingRules,
    },
  });
};
