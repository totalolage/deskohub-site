import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import type { Locale } from "@/features/i18n";

const isAdministrationHref = (href: string) =>
  href === "/admin" || /^\/admin[/?#]/.test(href);

/**
 * Places an administration href under the locale segment. Administration code
 * writes its paths unprefixed (`/admin/...`); other hrefs pass through.
 */
export const localizeAdministrationHref = (href: string, locale: Locale) =>
  isAdministrationHref(href) ? prefixPathnameWithLocale(href, locale) : href;
