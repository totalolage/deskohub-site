import type { Locale } from "@/features/i18n";
import type {
  LegalDocumentBody,
  LegalDocumentTranslation,
} from "./legal-document-body";
import {
  getLegalDocumentSummary,
  type LegalDocumentKey,
  type LegalDocumentSummary,
} from "./legal-document-summaries";
import { legalDocuments as czech } from "./locales/cs-CZ/documents";
import { translation as german } from "./locales/de-DE/documents";
import { translation as english } from "./locales/en-US/documents";
import { translation as slovak } from "./locales/sk-SK/documents";
import { translation as ukrainian } from "./locales/uk-UA/documents";

export type LegalDocumentContent = LegalDocumentSummary &
  LegalDocumentBody & {
    /** Set on every translation: the Czech text governs on any discrepancy. */
    readonly translationNotice?: string;
  };

/** The locale whose legal text governs; every other locale translates it. */
const governingLocale = "cs-CZ" satisfies Locale;

const translations = {
  "en-US": english,
  "de-DE": german,
  "uk-UA": ukrainian,
  "sk-SK": slovak,
} satisfies Record<
  Exclude<Locale, typeof governingLocale>,
  LegalDocumentTranslation
>;

export function getLegalDocument(
  locale: Locale,
  documentKey: LegalDocumentKey
): LegalDocumentContent {
  const summary = getLegalDocumentSummary(locale, documentKey);
  if (locale === governingLocale) {
    return { ...summary, ...czech[documentKey] };
  }

  const { documents, translationNotice } = translations[locale];
  return { ...summary, ...documents[documentKey], translationNotice };
}
