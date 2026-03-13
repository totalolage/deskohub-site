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

export function getAllLocalizedPaths(pathname: string) {
  return getLocalizedPathVariants(pathname, locales);
}
