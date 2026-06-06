import {
  getLocaleFromPathname as getLocaleFromPathnameShared,
  getLocalizedPathVariants,
  pathnameHasLocale as pathnameHasLocaleShared,
  replaceLocaleInPathname,
  stripLocaleFromPathname,
} from "@deskohub/i18n/pathname";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";

export function getLocaleFromPathname(pathname: string): Locale | undefined {
  return getLocaleFromPathnameShared(pathname, locales);
}

export function setLocaleInPathname(pathname: string, locale: Locale): string {
  return replaceLocaleInPathname(pathname, locale, locales);
}

export function removeLocaleFromPathname(pathname: string): string {
  return stripLocaleFromPathname(pathname, locales);
}

export function pathnameHasLocale(pathname: string): boolean {
  return pathnameHasLocaleShared(pathname, locales);
}

export function getLocalizedHref(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;

  const suffixIndex = href.search(/[?#]/);
  const pathname = suffixIndex === -1 ? href : href.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : href.slice(suffixIndex);

  return `${setLocaleInPathname(pathname, locale)}${suffix}`;
}

export function getAllLocalizedPaths(pathname: string) {
  return getLocalizedPathVariants(pathname, locales);
}
