import { type CountryCode, parsePhoneNumber } from "libphonenumber-js";

/**
 * Extracts country code from locale string
 * Uses the standardized locale format (language-COUNTRY)
 */
const getCountryFromLocale = (locale: string): CountryCode | undefined => {
  try {
    // Use Intl.Locale to parse the locale properly
    const localeObj = new Intl.Locale(locale);
    const region = localeObj.region;

    if (region && region.length === 2) {
      return region as CountryCode;
    }
  } catch {
    // Fallback: Try to extract from locale string
    const parts = locale.split(/[-_]/);
    const countryPart = parts[1];
    if (countryPart && countryPart.length === 2) {
      return countryPart.toUpperCase() as CountryCode;
    }
  }

  return undefined;
};

/**
 * Formats a phone number for display based on locale
 * @param phoneNumber - Phone number string (e.g., "+420777060478")
 * @param locale - The locale to use for formatting
 * @returns Formatted phone number string
 */
export const formatPhoneNumber = (
  phoneNumber: string,
  locale: string
): string => {
  try {
    // Parse the phone number
    const parsed = parsePhoneNumber(phoneNumber);

    if (!parsed) {
      // If parsing fails, return the original
      return phoneNumber;
    }

    // Get the country from locale for formatting style
    const country = getCountryFromLocale(locale);

    // Format based on whether it's the same country or international
    if (country && parsed.country === country) {
      // National format for same country
      return parsed.formatNational();
    } else {
      // International format for different countries
      return parsed.formatInternational();
    }
  } catch (_error) {
    // If any error occurs, return the original phone number
    return phoneNumber;
  }
};

/**
 * Creates a clickable tel: link from a phone number
 * @param phoneNumber - Phone number string
 * @returns Cleaned phone number suitable for tel: links
 */
export const getPhoneLink = (phoneNumber: string): string => {
  // Remove all non-numeric characters except +
  return phoneNumber.replace(/[^\d+]/g, "");
};
