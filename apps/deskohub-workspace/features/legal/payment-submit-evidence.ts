import { Schema } from "effect";
import {
  type LegalEvidenceMap,
  legalEvidenceMapSchema,
  paymentSubmitLegalEvidenceSource,
} from "@/features/checkout/legal-evidence";
import type { Locale } from "@/features/i18n";
import {
  getLegalDocumentVersion,
  legalDocumentHashAlgorithm,
} from "./document-version";
import { getLegalDocumentPath } from "./legal-document-path";
import type { LegalDocumentKey } from "./legal-document-summaries";

const decodeLegalEvidenceMap = Schema.decodeUnknownSync(
  legalEvidenceMapSchema,
  { onExcessProperty: "error" }
);

/** The documents a customer accepts when they submit a payment. */
const paymentSubmitLegalDocumentKeys = [
  "terms-and-conditions",
  "operating-rules",
] as const satisfies ReadonlyArray<LegalDocumentKey>;

type PaymentSubmitLegalDocumentKey =
  (typeof paymentSubmitLegalDocumentKeys)[number];

/** A published document a payment submission accepts, at its current version. */
export type PaymentSubmitLegalDocument = {
  readonly key: PaymentSubmitLegalDocumentKey;
  readonly path: string;
  readonly hash: string;
  readonly hashAlgorithm: typeof legalDocumentHashAlgorithm;
};

const getAcceptedDocument = (
  locale: Locale,
  documentKey: PaymentSubmitLegalDocumentKey
): Omit<PaymentSubmitLegalDocument, "key"> => ({
  path: getLegalDocumentPath(locale, documentKey),
  hash: getLegalDocumentVersion(locale, documentKey),
  hashAlgorithm: legalDocumentHashAlgorithm,
});

/**
 * The documents a payment submission accepts in `locale`, at the versions its
 * evidence records: the terms and conditions, then the operating rules.
 */
export const getPaymentSubmitLegalDocuments = (
  locale: Locale
): ReadonlyArray<PaymentSubmitLegalDocument> =>
  paymentSubmitLegalDocumentKeys.map((key) => ({
    key,
    ...getAcceptedDocument(locale, key),
  }));

/**
 * Whether a client accepted exactly the documents a payment submission in
 * `locale` records, each at its current version. A client that showed an
 * older version, or left a document out, has to show them again.
 */
export const isCurrentPaymentSubmitLegalAcceptance = (
  locale: Locale,
  acceptedDocuments: ReadonlyArray<{
    readonly key: string;
    readonly hash: string;
  }>
): boolean => {
  const current = getPaymentSubmitLegalDocuments(locale);
  const accepted = new Map(
    acceptedDocuments.map(({ key, hash }) => [key, hash])
  );

  return (
    acceptedDocuments.length === current.length &&
    accepted.size === current.length &&
    current.every(({ key, hash }) => accepted.get(key) === hash)
  );
};

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
