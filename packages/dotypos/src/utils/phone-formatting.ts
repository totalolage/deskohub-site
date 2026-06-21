import { type CountryCode, parsePhoneNumber } from "libphonenumber-js";

const DEFAULT_COUNTRY: CountryCode = "CZ";

export const normalizePhoneNumber = (
  phoneNumber: string | null | undefined,
  countryCode: CountryCode = DEFAULT_COUNTRY
): string | null => {
  if (!phoneNumber) return null;

  const cleaned = phoneNumber.trim();
  if (!cleaned) return null;

  try {
    const parsed = parsePhoneNumber(cleaned, countryCode);
    if (!parsed || !parsed.isValid()) {
      return null;
    }

    return parsed.format("E.164");
  } catch {
    return null;
  }
};
