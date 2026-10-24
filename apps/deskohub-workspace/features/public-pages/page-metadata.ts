import { toOpenGraphLocale } from "@deskohub/i18n/core";
import type { Metadata } from "next";
import { getWorkspaceAlternates, type Locale, locales } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";

/**
 * The page's own title, which gets the site name appended, or an absolute
 * title written in full that already names the site.
 */
type PublicPageTitle =
  | { readonly page: string }
  | { readonly absolute: string };

type PublicPageMetadataInput = {
  readonly locale: Locale;
  /**
   * Unprefixed pathname; the canonical and hreflang URLs name each
   * locale's page.
   */
  readonly pathname: string;
  readonly title: PublicPageTitle;
  /** Omitted, the page keeps the layout's description. */
  readonly description?: string;
  readonly type?: "website" | "article";
};

/**
 * The layouts' metadata that Next passes `generateMetadata` as `parent`, of
 * which the builder reads only the share image.
 */
export type ParentMetadata = Promise<{
  readonly openGraph: {
    readonly images?: NonNullable<Metadata["openGraph"]>["images"];
  } | null;
}>;

/** The document title a page renders: `<page title> | Deskohub Workspace`. */
export const getPublicPageTitle = (title: PublicPageTitle): string =>
  "absolute" in title
    ? title.absolute
    : `${title.page} | ${workspaceSiteConstants.brand.name}`;

/**
 * Title, description, canonical and hreflang URLs, and the complete Open
 * Graph and Twitter card of a page on the public site. A page's `openGraph`
 * replaces the layouts' whole, so the share image the `opengraph-image`
 * file gives the locale layout is carried over from `parent`.
 */
export async function createPublicPageMetadata(
  {
    locale,
    pathname,
    title,
    description,
    type = "website",
  }: PublicPageMetadataInput,
  parent: ParentMetadata
): Promise<Metadata> {
  const { openGraph } = await parent;
  const documentTitle = getPublicPageTitle(title);
  const alternates = getWorkspaceAlternates(locale, pathname);

  return {
    title: documentTitle,
    ...(description !== undefined && { description }),
    alternates,
    openGraph: {
      type,
      title: documentTitle,
      ...(description !== undefined && { description }),
      url: alternates.canonical,
      siteName: workspaceSiteConstants.brand.name,
      locale: toOpenGraphLocale(locale),
      alternateLocale: locales
        .filter((alternateLocale) => alternateLocale !== locale)
        .map(toOpenGraphLocale),
      images: openGraph?.images,
    },
    // The title, description and image follow from `openGraph`.
    twitter: { card: "summary_large_image" },
  };
}
