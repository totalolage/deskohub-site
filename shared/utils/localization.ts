import type { Locale } from "@/i18n";

/**
 * Get localized text from a translatable object
 * @param text - Object with locale keys and translated values, or plain string
 * @param locale - Target locale
 * @returns Localized string or fallback
 */
export const getLocalizedText = (
  translations: Record<string, string>,
  locale: Locale,
  defaultValue?: string
): string | undefined => {
  const localeTranslation = translations[locale];
  if (localeTranslation) return localeTranslation;

  const languageTranslation = translations[locale.split("-")[0]];
  if (languageTranslation) return languageTranslation;

  return defaultValue;
};
