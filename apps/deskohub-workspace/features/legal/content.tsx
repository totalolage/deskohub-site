import type { Locale } from "@/features/i18n";
import type {
  LegalDocumentBodies,
  LegalDocumentBody,
} from "./legal-document-body";
import {
  getLegalDocumentSummary,
  type LegalDocumentKey,
  type LegalDocumentSummary,
} from "./legal-document-summaries";
import { legalDocuments as czech } from "./locales/cs-CZ/documents";
import { legalDocuments as english } from "./locales/en-US/documents";

export type LegalDocumentContent = LegalDocumentSummary & LegalDocumentBody;

const legalDocuments = {
  "en-US": english,
  "cs-CZ": czech,
} satisfies Record<Locale, LegalDocumentBodies>;

export function getLegalDocument(
  locale: Locale,
  documentKey: LegalDocumentKey
): LegalDocumentContent {
  return {
    ...getLegalDocumentSummary(locale, documentKey),
    ...legalDocuments[locale][documentKey],
  };
}
