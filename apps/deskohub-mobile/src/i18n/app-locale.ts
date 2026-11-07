import { resolvePreferredLocale } from "@deskohub/i18n/core";
import { baseLocale, locales } from "./paraglide/runtime.js";

export type AppLocale = "cs-CZ" | "en-US";

// Paraglide's project settings own the locale list; `satisfies` fails the
// typecheck when they gain a locale this union lacks.
const appLocales = locales satisfies ReadonlyArray<AppLocale>;
const defaultAppLocale = baseLocale satisfies AppLocale;

const appLocaleByLanguage = {
  cs: "cs-CZ",
  en: "en-US",
} as const satisfies Record<string, AppLocale>;

/**
 * Picks the app locale for the device's preferred language tags, best first.
 * A tag without a region falls back to its language's locale; with no
 * supported tag the app uses its base locale.
 */
export const resolveAppLocale = (
  languageTags: ReadonlyArray<string>
): AppLocale =>
  resolvePreferredLocale({
    // Device tags carry no weights, so in Accept-Language form their order
    // stays the preference order.
    headerValue: languageTags.join(","),
    locales: appLocales,
    preferredLanguageToLocale: appLocaleByLanguage,
  }) ?? defaultAppLocale;
