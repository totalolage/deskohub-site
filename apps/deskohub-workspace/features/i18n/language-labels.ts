import {
  getLocaleDefinition,
  mapSupportedLocales,
} from "@deskohub/i18n/locale-registry";
import type { Locale } from "./paraglide/runtime.js";

/**
 * Each locale's language named in itself, as a language picker shows it, so
 * a reader finds their language whatever the page's current one.
 */
export const languageNames: Readonly<Record<Locale, string>> =
  mapSupportedLocales((locale) => getLocaleDefinition(locale).nativeName);
