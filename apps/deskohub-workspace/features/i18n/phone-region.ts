import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import type { Locale } from "./paraglide/runtime.js";

/**
 * The region a phone number entered without a country calling code is read
 * in for a locale. A number with a leading `+` reads the same in every region.
 */
export const defaultPhoneRegion = (locale: Locale): string =>
  getLocaleDefinition(locale).phoneRegion;
