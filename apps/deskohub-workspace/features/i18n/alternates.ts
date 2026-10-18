import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { getWorkspaceCanonicalUrl } from "@/shared/utils/site-constants";
import type { Locale } from "./paraglide/runtime.js";
import { locales } from "./routing";

/**
 * Canonical and hreflang alternates for a page served under every locale
 * prefix. `x-default` is the unprefixed URL, which the proxy redirects to the
 * visitor's resolved locale.
 */
export function getWorkspaceAlternates(locale: Locale, pathname = "/") {
  return {
    canonical: getWorkspaceCanonicalUrl(
      prefixPathnameWithLocale(pathname, locale)
    ),
    languages: {
      ...Object.fromEntries(
        locales.map((alternateLocale) => [
          alternateLocale,
          getWorkspaceCanonicalUrl(
            prefixPathnameWithLocale(pathname, alternateLocale)
          ),
        ])
      ),
      "x-default": getWorkspaceCanonicalUrl(pathname),
    },
  };
}
