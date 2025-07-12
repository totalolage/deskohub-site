import type { Locale } from "@/i18n";
import { isLocale, locales } from "@/i18n";

/**
 * Regex pattern to match locale prefix in URLs
 * Matches format: /xx-XX (e.g., /cs-CZ, /en-US)
 */
const LOCALE_PREFIX_REGEX = /^\/[a-z]{2}-[A-Z]{2}/;

/**
 * Parses a pathname to extract locale and path information
 * @param pathname - The pathname to parse
 * @returns Object containing locale and pathname without locale
 */
export function parseLocalizedPathname(pathname: string): {
  locale: Locale | undefined;
  pathname: string;
} {
  // Normalize pathname
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  // Try to extract locale
  const match = normalizedPath.match(LOCALE_PREFIX_REGEX);
  if (!match) {
    return { locale: undefined, pathname: normalizedPath };
  }

  const potentialLocale = match[0].substring(1); // Remove leading slash
  const locale = isLocale(potentialLocale) ? potentialLocale : undefined;
  const pathnameWithoutLocale = normalizedPath.slice(match[0].length) || "/";

  return { locale, pathname: pathnameWithoutLocale };
}

/**
 * Creates a localized pathname by combining a locale and path
 * @param pathname - The pathname without locale
 * @param locale - The locale to prepend
 * @returns The localized pathname
 */
export function createLocalizedPathname(
  pathname: string,
  locale: Locale
): string {
  // Normalize pathname
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

  // Handle root path
  if (normalizedPath === "/") {
    return `/${locale}`;
  }

  return `/${locale}${normalizedPath}`;
}

/**
 * Object containing unified locale URL manipulation functions
 * These functions follow the patterns established by next-intl and other i18n libraries
 */
export const localeUrl = {
  /**
   * Get the locale from a pathname
   * @param pathname - The pathname to extract locale from
   * @returns The locale if found, undefined otherwise
   * @example
   * localeUrl.get("/cs-CZ/about") // returns "cs-CZ"
   * localeUrl.get("/about") // returns undefined
   */
  get(pathname: string): Locale | undefined {
    const { locale } = parseLocalizedPathname(pathname);
    return locale;
  },

  /**
   * Set a locale in a pathname (replaces any existing locale)
   * @param pathname - The pathname to modify
   * @param locale - The locale to set
   * @returns The pathname with the locale set
   * @example
   * localeUrl.set("/about", "cs-CZ") // returns "/cs-CZ/about"
   * localeUrl.set("/en-US/about", "cs-CZ") // returns "/cs-CZ/about"
   */
  set(pathname: string, locale: Locale): string {
    const { pathname: pathWithoutLocale } = parseLocalizedPathname(pathname);
    return createLocalizedPathname(pathWithoutLocale, locale);
  },

  /**
   * Remove the locale from a pathname
   * @param pathname - The pathname to remove locale from
   * @returns The pathname without locale prefix
   * @example
   * localeUrl.remove("/cs-CZ/about") // returns "/about"
   * localeUrl.remove("/about") // returns "/about"
   */
  remove(pathname: string): string {
    const { pathname: pathWithoutLocale } = parseLocalizedPathname(pathname);
    return pathWithoutLocale;
  },

  /**
   * Check if a pathname has a locale prefix
   * @param pathname - The pathname to check
   * @returns True if the pathname has a valid locale prefix
   * @example
   * localeUrl.has("/cs-CZ/about") // returns true
   * localeUrl.has("/about") // returns false
   */
  has(pathname: string): boolean {
    const { locale } = parseLocalizedPathname(pathname);
    return locale !== undefined;
  },

  /**
   * Switch the locale in a pathname, preserving the path
   * This is an alias for set() but more semantic for language switching
   * @param pathname - The current pathname
   * @param locale - The new locale
   * @returns The pathname with the new locale
   * @example
   * localeUrl.switch("/cs-CZ/about", "en-US") // returns "/en-US/about"
   */
  switch(pathname: string, locale: Locale): string {
    return this.set(pathname, locale);
  },
};

/**
 * Helper function to get all possible localized paths for a given pathname
 * Useful for generating alternate links for SEO
 * @param pathname - The pathname (with or without locale)
 * @returns Array of all possible localized paths
 * @example
 * getAllLocalizedPaths("/about") // returns ["/cs-CZ/about", "/en-US/about"]
 */
export function getAllLocalizedPaths(pathname: string): string[] {
  const { pathname: pathWithoutLocale } = parseLocalizedPathname(pathname);
  return locales.map((locale) =>
    createLocalizedPathname(pathWithoutLocale, locale)
  );
}

/**
 * Helper function to create a path matcher that works with any locale
 * Useful for middleware and routing configurations
 * @param pattern - The path pattern without locale
 * @returns Regex pattern that matches the path with any locale prefix
 * @example
 * createLocalizedPathMatcher("/about") // matches "/cs-CZ/about", "/en-US/about", etc.
 */
export function createLocalizedPathMatcher(pattern: string): RegExp {
  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const localePattern = locales
    .map((locale) => locale.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`^/(${localePattern})${escapedPattern}$`);
}
