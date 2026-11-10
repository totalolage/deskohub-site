import {
  matchSupportedLocale,
  unservedLanguageLocale,
} from "@deskohub/i18n/locale-registry";
import { isLocale, type Locale, locales } from "./paraglide/runtime.js";

/**
 * A locale the app is translated into. Paraglide generates it from the Inlang
 * project, whose locales are the registry's (`locale-registry.typecheck.ts`).
 */
export type AppLocale = Locale;

/** Every app locale, in the registry's order. */
export const appLocales = locales;

/**
 * Picks the app locale for the device's preferred language tags, best first.
 * The first tag whose language Deskohub serves wins, whatever its region
 * (`de-AT` reads German); with none the app uses the locale for unserved
 * languages.
 */
export const resolveAppLocale = (
  languageTags: ReadonlyArray<string>
): AppLocale => {
  for (const languageTag of languageTags) {
    const locale = matchSupportedLocale(languageTag);
    if (locale !== undefined) return locale;
  }
  return unservedLanguageLocale;
};

/** Whether a value names a locale the app supports. */
export const isAppLocale = (value: unknown): value is AppLocale =>
  isLocale(value);
