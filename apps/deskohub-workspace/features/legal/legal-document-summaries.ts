import type { Locale } from "@/features/i18n";
import { legalDocumentSummaries as czech } from "./locales/cs-CZ/summaries";
import { legalDocumentSummaries as german } from "./locales/de-DE/summaries";
import { legalDocumentSummaries as english } from "./locales/en-US/summaries";
import { legalDocumentSummaries as hindi } from "./locales/hi-IN/summaries";
import { legalDocumentSummaries as slovak } from "./locales/sk-SK/summaries";
import { legalDocumentSummaries as ukrainian } from "./locales/uk-UA/summaries";
import { legalDocumentSummaries as vietnamese } from "./locales/vi-VN/summaries";

// Page metadata and llms.txt read a legal document's title and lead without
// its body, so this module holds plain strings and no rendering.

export type LegalDocumentKey =
  | "privacy-policy"
  | "marketing-communications"
  | "terms-and-conditions"
  | "cookie-policy"
  | "operating-rules";

export interface LegalDocumentSummary {
  readonly title: string;
  readonly lead: string;
}

const legalDocumentSummaries = {
  "en-US": english,
  "cs-CZ": czech,
  "de-DE": german,
  "uk-UA": ukrainian,
  "sk-SK": slovak,
  "vi-VN": vietnamese,
  "hi-IN": hindi,
} satisfies Record<Locale, Record<LegalDocumentKey, LegalDocumentSummary>>;

export function getLegalDocumentSummary(
  locale: Locale,
  documentKey: LegalDocumentKey
): LegalDocumentSummary {
  return legalDocumentSummaries[locale][documentKey];
}
