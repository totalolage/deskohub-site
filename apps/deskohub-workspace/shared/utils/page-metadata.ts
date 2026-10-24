import type { Metadata } from "next";
import { getWorkspaceAlternates, type Locale } from "@/features/i18n";
import { workspaceSiteConstants } from "./site-constants";

/**
 * A localized site page's metadata: its title and description, the
 * self-canonical and hreflang alternates for `pathname`, and the matching
 * Open Graph card.
 */
export function getPageMetadata(
  locale: Locale,
  pathname: string,
  {
    title,
    description,
    document = false,
  }: {
    readonly title: string;
    readonly description?: string;
    /**
     * A legal document: the browser title names the brand after the
     * document's title, and the card shares it as an article.
     */
    readonly document?: boolean;
  }
): Metadata {
  const alternates = getWorkspaceAlternates(locale, pathname);
  const siteName = workspaceSiteConstants.brand.name;

  return {
    title: document ? `${title} | ${siteName}` : title,
    description,
    alternates,
    openGraph: {
      title,
      description,
      url: alternates.canonical,
      siteName,
      locale,
      type: document ? "article" : "website",
    },
  };
}
