import {
  parseLocalizedPathname,
  prefixPathnameWithLocale,
} from "@deskohub/i18n/pathname";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n/routing";
import { preferredMediaType } from "@/shared/utils/media-type-negotiation";
import { isPublicPagePathname, type PublicPagePathname } from "./public-pages";

// The proxy imports this module, so it stays clear of the message catalogs
// and the Markdown serializer.

/** The internal route that serves public pages as Markdown. */
const pageMarkdownRoutePrefix = "/page-markdown";

/** The public page and locale a localized pathname such as `/en-US/faq` shows. */
export const findLocalizedPublicPage = (
  localizedPathname: string
): { locale: Locale; pathname: PublicPagePathname } | undefined => {
  const { locale, pathname } = parseLocalizedPathname(
    localizedPathname,
    locales
  );
  return locale && isPublicPagePathname(pathname)
    ? { locale, pathname }
    : undefined;
};

/** Whether the request's `Accept` header prefers Markdown over HTML. */
export const prefersMarkdown = (headers: Headers) =>
  preferredMediaType(headers, ["text/html", "text/markdown"]) ===
  "text/markdown";

/** Where the proxy rewrites a Markdown request for a public page. */
export const getPageMarkdownRoutePath = (
  locale: Locale,
  pathname: PublicPagePathname
) => `${pageMarkdownRoutePrefix}${prefixPathnameWithLocale(pathname, locale)}`;
