import type { Locale } from "@/features/i18n";
import type { LegalDocumentKey } from "./legal-document-summaries";

/** The site path of a published legal document in the locale. */
export function getLegalDocumentPath(
  locale: Locale,
  documentKey: LegalDocumentKey
): string {
  return `/${locale}/${documentKey}`;
}
