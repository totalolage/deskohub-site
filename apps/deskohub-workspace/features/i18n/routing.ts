import {
  resolveLocaleFromPolicy as resolveLocaleFromPolicyShared,
  resolvePreferredLocale,
} from "@deskohub/i18n/core";
import {
  getLocaleFromPathname as getLocaleFromPathnameShared,
  replaceLocaleInPathname,
} from "@deskohub/i18n/pathname";
import {
  baseLocale,
  cookieName,
  type Locale,
  locales,
} from "./paraglide/runtime.js";

export { locales };

export const defaultLocale: Locale = baseLocale;

export const localeCookieName = cookieName;

export const localeConfig = {
  locales,
  baseLocale: defaultLocale,
  preferredLanguageToLocale: {
    cs: "cs-CZ",
    en: "en-US",
  },
} as const;

export const getLocaleFromPathname = (pathname: string): Locale | undefined =>
  getLocaleFromPathnameShared(pathname, locales);

export const getPreferredLocaleFromAcceptLanguage = (
  headerValue: string | null
): Locale | undefined => {
  return resolvePreferredLocale({
    headerValue,
    locales: localeConfig.locales,
    preferredLanguageToLocale: localeConfig.preferredLanguageToLocale,
  });
};

type ResolveLocaleInput = {
  localeFromUrl?: string;
  localeFromCookie?: string;
  localeFromPreferredLanguage?: Locale;
};

export const resolveLocaleFromPolicy = ({
  localeFromUrl,
  localeFromCookie,
  localeFromPreferredLanguage,
}: ResolveLocaleInput): Locale => {
  return resolveLocaleFromPolicyShared({
    localeFromUrl,
    localeFromCookie,
    localeFromPreferredLanguage,
    locales: localeConfig.locales,
    fallbackLocale: localeConfig.baseLocale,
  });
};

export const withLocalePrefix = (pathname: string, locale: Locale): string =>
  replaceLocaleInPathname(pathname, locale, locales);

export const withLocalePrefixAndSearch = (
  pathname: string,
  locale: Locale,
  searchParams: Pick<URLSearchParams, "toString"> | string
): string => {
  const localizedPathname = withLocalePrefix(pathname, locale);
  const rawSearchString =
    typeof searchParams === "string" ? searchParams : searchParams.toString();
  const searchString = rawSearchString.startsWith("?")
    ? rawSearchString.slice(1)
    : rawSearchString;

  if (!searchString) {
    return localizedPathname;
  }

  return `${localizedPathname}?${searchString}`;
};
