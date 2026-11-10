import type { Locale } from "@/features/i18n";
import { translationDate as german } from "./locales/de-DE/translation-date";
import { translationDate as english } from "./locales/en-US/translation-date";
import { translationDate as hindi } from "./locales/hi-IN/translation-date";
import { translationDate as slovak } from "./locales/sk-SK/translation-date";
import { translationDate as ukrainian } from "./locales/uk-UA/translation-date";
import { translationDate as vietnamese } from "./locales/vi-VN/translation-date";

// Page metadata and the sitemap read these dates without a document body, so
// this module holds plain strings and no rendering.

/** The locale whose legal text governs; every other locale translates it. */
export const governingLegalLocale = "cs-CZ" satisfies Locale;

/**
 * The ISO day a locale's legal text last changed on its own, such as its
 * translation notice or a translation fix, while the governing Czech version
 * and its document date stayed the same. The sitemap dates the locale's legal
 * pages by it when it is later than the document date. It is not part of a
 * document, so it never changes a document's version.
 */
export type LegalTranslationDate = `${number}-${number}-${number}`;

export const legalTranslationDates = {
  "en-US": english,
  "de-DE": german,
  "uk-UA": ukrainian,
  "sk-SK": slovak,
  "vi-VN": vietnamese,
  "hi-IN": hindi,
} as const satisfies Record<
  Exclude<Locale, typeof governingLegalLocale>,
  LegalTranslationDate
>;
