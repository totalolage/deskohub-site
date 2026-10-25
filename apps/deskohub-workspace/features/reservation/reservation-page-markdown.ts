import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { getWorkspacePageUrl, type Locale } from "@/features/i18n";
import { publicPageDefinitions } from "@/features/public-pages/public-page-definitions";
import type { PublicPagePathname } from "@/features/public-pages/public-pages";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/**
 * A reservation page as Markdown: its title and description as the page
 * defines them, the opening hours, the products it books, and a link to the
 * page to book them.
 */
export const reservationPageMarkdown = ({
  bookingLabel,
  locale,
  pathname,
  products,
}: {
  readonly bookingLabel: string;
  readonly locale: Locale;
  readonly pathname: PublicPagePathname;
  readonly products: MarkdownBlocks;
}): MarkdownBlocks => {
  const { title, description } = publicPageDefinitions[pathname];

  return [
    markdownHeading(1, title({}, { locale })),
    ...(description ? [markdownParagraph(description({}, { locale }))] : []),
    markdownParagraph(getPublicOpeningHours(locale)),
    ...products,
    markdownParagraph(
      markdownLink(getWorkspacePageUrl(pathname), bookingLabel)
    ),
  ];
};
