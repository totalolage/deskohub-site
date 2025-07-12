import type { Locale } from "@/i18n";
import { locales } from "@/i18n";

/**
 * Parses a pathname to extract locale and path information
 * @param pathname - The pathname to parse
 * @returns Object containing locale and pathname without locale
 */
function parseLocalizedPathname(pathname: string): {
  locale: Locale | undefined;
  pathname: string;
} {
  const extractedLocale = getLocaleFromPathname(pathname);
  return {
    locale: extractedLocale,
    pathname: pathname.replace(new RegExp(`^/${extractedLocale}`), ""),
  };
}

export function getLocaleFromPathname(pathname: string): Locale | undefined {
  return locales.find((locale) => pathname.startsWith(`/${locale}`));
}

export function setLocaleInPathname(pathname: string, locale: Locale): string {
  const pathWithoutLocale = parseLocalizedPathname(pathname).pathname;
  return [locale, pathWithoutLocale]
    .filter(Boolean)
    .map((part) => `/${part.replaceAll(/(^\/|\/$)/g, "")}`)
    .join("");
}

export function removeLocaleFromPathname(pathname: string): string {
  return parseLocalizedPathname(pathname).pathname;
}

export function pathnameHasLocale(pathname: string): boolean {
  return parseLocalizedPathname(pathname).locale !== undefined;
}

export function getAllLocalizedPaths(pathname: string) {
  const localesAndPaths = locales.map((locale): [Locale, string] => [
    locale,
    setLocaleInPathname(pathname, locale),
  ]);

  const pathsWithEntries = Object.assign(
    localesAndPaths.map(([, path]) => path),
    {
      entires: () => localesAndPaths,
    },
  );

  return pathsWithEntries;
}
