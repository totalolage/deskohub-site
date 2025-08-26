import {
  type CountryCode,
  isValidPhoneNumber,
  parsePhoneNumber,
} from "libphonenumber-js";

/**
 * Default country code for phone number parsing
 * Czech Republic is the primary market
 */
const DEFAULT_COUNTRY: CountryCode = "CZ";

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
 * Normalizes a phone number to E.164 format for consistent storage
 * @param phoneNumber - Raw phone number input from user
 * @param countryCode - Country code for parsing (defaults to CZ)
 * @returns E.164 formatted phone number (e.g., "+420777060478") or null if invalid
 */
export const normalizePhoneNumber = (
  phoneNumber: string | null | undefined,
  countryCode: CountryCode = DEFAULT_COUNTRY
): string | null => {
  if (!phoneNumber) return null;

  try {
    // Remove any whitespace
    const cleaned = phoneNumber.trim();
    if (!cleaned) return null;

    // Check if it's a valid phone number for the given country
    if (!isValidPhoneNumber(cleaned, countryCode)) {
      // Try parsing without country code (might have international prefix)
      if (!isValidPhoneNumber(cleaned)) {
        return null;
      }
    }

    // Parse the phone number
    const parsed = parsePhoneNumber(cleaned, countryCode);

    if (!parsed || !parsed.isValid()) {
      return null;
    }

    // Return E.164 format (e.g., "+420777060478")
    return parsed.format("E.164");
  } catch (error) {
    console.warn("Failed to normalize phone number:", phoneNumber, error);
    return null;
  }
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
