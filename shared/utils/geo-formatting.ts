/**
 * Utilities for formatting geographic names (countries, regions) using the Intl API
 */

/**
 * Gets the localized name of a country/region using ISO 3166-1 alpha-2 codes
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "CZ", "US")
 * @param locale - The locale to use for formatting
 * @returns Localized country name or the code if not found
 */
export const getLocalizedCountryName = (
  countryCode: string,
  locale: string
): string => {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "region" });
    return displayNames.of(countryCode) || countryCode;
  } catch {
    // Fallback if locale is not supported
    return countryCode;
  }
};

/**
 * Gets the localized name of a language
 * @param languageCode - ISO 639-1 language code (e.g., "cs", "en")
 * @param locale - The locale to use for formatting
 * @returns Localized language name or the code if not found
 */
export const getLocalizedLanguageName = (
  languageCode: string,
  locale: string
): string => {
  try {
    const displayNames = new Intl.DisplayNames([locale], { type: "language" });
    return displayNames.of(languageCode) || languageCode;
  } catch {
    // Fallback if locale is not supported
    return languageCode;
  }
};

/**
 * Gets a translated city name based on locale
 * @param cityKey - The key for the city (e.g., "Prague")
 * @param locale - The locale to use for translation
 * @returns The translated city name
 */
export const getTranslatedCityName = (
  cityKey: string,
  locale: string
): string => {
  // Define city translations
  // In a larger app, this could come from a separate file or API
  const cityTranslations: Record<string, Record<string, string>> = {
    Prague: {
      "cs-CZ": "Praha",
      "en-US": "Prague",
    },
  };

  const translations = cityTranslations[cityKey];
  if (translations?.[locale]) {
    return translations[locale];
  }

  // Fallback to the key itself
  return cityKey;
};
