import { type CountryCode, isValidPhoneNumber } from "libphonenumber-js";
import type { Locale } from "@/features/i18n";
import {
  formatPhoneNumber,
  normalizePhoneNumber,
} from "@/shared/utils/phone-formatting";

/**
 * Whether the field should take over a changed controlled value. It never
 * does while focused, so the parent can't overwrite what is being typed.
 */
export const adoptsControlledPhoneValue = ({
  value,
  displayValue,
  isFocused,
}: {
  value: string;
  displayValue: string;
  isFocused: boolean;
}) => !isFocused && value !== displayValue;

/**
 * The E.164 form and validity of the entered phone number. Both are `null`
 * while the field is blank, so a blank field is neither valid nor invalid.
 */
export const phoneNumberValidity = (
  displayValue: string,
  countryCode: CountryCode
): { normalized: string | null; isValid: boolean | null } => {
  if (!displayValue?.trim()) return { normalized: null, isValid: null };

  return {
    normalized: normalizePhoneNumber(displayValue, countryCode),
    isValid: isValidPhoneNumber(displayValue, countryCode),
  };
};

/**
 * The entered phone number in the locale's display format, or `null` when it
 * is blank or can't be read as a phone number and should stay as typed.
 */
export const phoneNumberFormattedOnBlur = (
  displayValue: string,
  countryCode: CountryCode,
  locale: Locale
): string | null => {
  if (!displayValue?.trim()) return null;

  const normalized = normalizePhoneNumber(displayValue, countryCode);
  return normalized ? formatPhoneNumber(normalized, locale) : null;
};

/** The input's variant: the caller's choice, else an error once invalid. */
export const phoneInputVariant = (
  variant: "default" | "error" | undefined,
  isValid: boolean | null
) => variant || (isValid === false ? "error" : "default");
