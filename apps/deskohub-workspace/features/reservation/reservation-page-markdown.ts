import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { getWorkspacePageUrl, type Locale } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";

/**
 * A reservation page as Markdown: its heading and summary, the opening
 * hours, the products it books, and a link to the page to book them.
 */
export const reservationPageMarkdown = ({
  bookingLabel,
  locale,
  pathname,
  products,
  summary,
  title,
}: {
  readonly bookingLabel: string;
  readonly locale: Locale;
  readonly pathname: string;
  readonly products: MarkdownBlocks;
  readonly summary: string;
  readonly title: string;
}): MarkdownBlocks => [
  markdownHeading(1, title),
  markdownParagraph(summary),
  markdownParagraph(getPublicOpeningHours(locale)),
  ...products,
  markdownParagraph(markdownLink(getWorkspacePageUrl(pathname), bookingLabel)),
];
