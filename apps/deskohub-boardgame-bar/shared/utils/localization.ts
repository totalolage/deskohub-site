import { getTranslatedValue } from "@deskohub/i18n/translatable";
import type { Locale } from "@/features/i18n";
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
  return getTranslatedValue(text, locale, defaultValue);
}

/**
 * @deprecated Use getLocalizedText instead
 */
export const getTranslatableText = getLocalizedText;
