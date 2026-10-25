import { toOpenGraphLocale } from "@deskohub/i18n/core";
import type { Metadata } from "next";
import { getWorkspaceAlternates, type Locale, locales } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import shareImage from "./share-image.jpg";

/**
 * The page's own title, which gets the site name appended, or an absolute
 * title written in full that already names the site.
 */
type PublicPageTitle =
  | { readonly page: string }
  | { readonly absolute: string };

type PageMetadataInput = {
  readonly locale: Locale;
  readonly title: PublicPageTitle;
  /** Omitted, the page keeps the layout's description. */
  readonly description?: string;
  readonly type?: "website" | "article";
};

type PublicPageMetadataInput = PageMetadataInput & {
  /**
   * Unprefixed pathname; the canonical and hreflang URLs name each
   * locale's page.
   */
  readonly pathname: string;
};

/** The photo of the space that a shared link to any page shows. */
export const publicSiteShareImage = {
  url: shareImage.src,
  width: shareImage.width,
  height: shareImage.height,
  type: "image/jpeg",
};

/** The document title a page renders: `<page title> | Deskohub Workspace`. */
export const getPublicPageTitle = (title: PublicPageTitle): string =>
  "absolute" in title
    ? title.absolute
    : `${title.page} | ${workspaceSiteConstants.brand.name}`;

type WorkspaceAlternates = ReturnType<typeof getWorkspaceAlternates>;

function createPageMetadata(
  { locale, title, description, type = "website" }: PageMetadataInput,
  alternates?: WorkspaceAlternates
): Metadata {
  const documentTitle = getPublicPageTitle(title);

  return {
    title: documentTitle,
    ...(description !== undefined && { description }),
    ...(alternates !== undefined && { alternates }),
    openGraph: {
      type,
      title: documentTitle,
      ...(description !== undefined && { description }),
      ...(alternates !== undefined && { url: alternates.canonical }),
      siteName: workspaceSiteConstants.brand.name,
      locale: toOpenGraphLocale(locale),
      alternateLocale: locales
        .filter((alternateLocale) => alternateLocale !== locale)
        .map(toOpenGraphLocale),
      images: [publicSiteShareImage],
    },
    // The title, description and image follow from `openGraph`.
    twitter: { card: "summary_large_image" },
  };
}

/**
 * Title, description, canonical and hreflang URLs, and the complete Open
 * Graph and Twitter card of a page on the public site. A page's `openGraph`
 * replaces the layouts' whole, so the card names the share image itself.
 */
export function createPublicPageMetadata({
  pathname,
  ...page
}: PublicPageMetadataInput): Metadata {
  return createPageMetadata(
    page,
    getWorkspaceAlternates(page.locale, pathname)
  );
}

type NoindexedPageMetadataInput = PageMetadataInput & {
  /**
   * Lets crawlers follow the page's links: the page is open to anyone but
   * not worth a search result. Private pages leave it out.
   */
  readonly followLinks?: true;
};

/**
 * The metadata of a page kept out of search results: the public page's title,
 * description and share card, with no canonical, hreflang or Open Graph URL
 * that would point crawlers at a URL they must not index.
 */
export function createNoindexedPageMetadata({
  followLinks,
  ...page
}: NoindexedPageMetadataInput): Metadata {
  return {
    ...createPageMetadata(page),
    robots: { index: false, follow: followLinks === true },
  };
}
