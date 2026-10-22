import { prefixPathnameWithLocale } from "@deskohub/i18n/pathname";
import { getWorkspaceCanonicalUrl } from "@/shared/utils/site-constants";
import { getWorkspacePageUrl } from "./page-url";
import type { Locale } from "./paraglide/runtime.js";
import { locales } from "./routing";

/**
 * Canonical and hreflang alternates for a page served under every locale
 * prefix. These name the exact locale page; `x-default` is the page's
 * locale-agnostic URL, which the proxy redirects to the visitor's locale.
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
      "x-default": getWorkspacePageUrl(pathname),
    },
  };
}
