import { stripLocaleFromPathname } from "@deskohub/i18n/pathname";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteOrigin,
} from "@/shared/utils/site-constants";
import { locales } from "./routing";

/**
 * A page's locale-agnostic URL: absolute, on the production origin, with no
 * locale prefix, so the proxy opens it in the visitor's language. Every
 * reference to a site page uses it, except the canonical, hreflang and
 * sitemap URLs, which name the exact locale page (`getWorkspaceAlternates`).
 * A locale prefix in `path` is dropped; its query and fragment are kept.
 */
export const getWorkspacePageUrl = (
  path: string,
  searchParams?: Parameters<typeof getWorkspaceCanonicalUrl>[1]
): string => {
  const url = new URL(path, workspaceSiteOrigin);
  url.pathname = stripLocaleFromPathname(url.pathname, locales);
  return getWorkspaceCanonicalUrl(url, searchParams);
};
