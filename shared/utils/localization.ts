import type { Locale } from "@/i18n";
import type { TranslatableString } from "@/types/translatable-string";

/**
 * Get localized text from a TranslatableString (plain string or translation record)
 * @param text - Plain string, translation record with locale keys, null or undefined
 * @param locale - Target locale
 * @param defaultValue - Optional fallback value
 * @returns The text string, localized text, or fallback
 */
export function getLocalizedText(
  text: TranslatableString | null | undefined,
  locale: Locale
): string | undefined;
export function getLocalizedText<D extends string | null | undefined>(
  text: TranslatableString | null | undefined,
  locale: Locale,
  defaultValue: D
): string | D;
export function getLocalizedText<D extends string | null | undefined>(
  text: TranslatableString | null | undefined,
  locale: Locale,
  defaultValue?: D
): string | D | undefined {
  if (!text) return defaultValue;

  // If it's already a plain string, return it directly
  if (typeof text === "string") return text;

  // Otherwise, it's a translation record
  const localeTranslation = text[locale];
  if (localeTranslation) return localeTranslation;

  // Try fallback to language without region (e.g., "en" from "en-US")
  const languageTranslation = text[locale.split("-")[0]!];
  if (languageTranslation) return languageTranslation;

  return defaultValue;
}

/**
 * @deprecated Use getLocalizedText instead
 */
export const getTranslatableText = getLocalizedText;
