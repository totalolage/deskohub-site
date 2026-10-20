import type { ListItem } from "mdast";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { publicOfferingsMarkdown } from "@/features/checkout/public-offerings-markdown";
import {
  getWorkspaceAlternates,
  type Locale,
  locales,
  m,
} from "@/features/i18n";
import { getLanguageLabels } from "@/features/i18n/language-labels";
import {
  type MarkdownBlocks,
  markdownBlockquote,
  markdownHeading,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  type PublicPageTopic,
  publicPageMarkdown,
} from "./public-page-markdown";
import type { PublicPagePathname } from "./public-pages";

/** `llms.txt` is written in English and links every locale of each page. */
export const llmsTxtLocale: Locale = "en-US";

/** Sections in the order `llms.txt` lists them, with their headings. */
const topicSections = [
  ["offer", (locale) => m.publicPageTopicOffer({}, { locale })],
  ["booking", (locale) => m.publicPageTopicBooking({}, { locale })],
  ["prices", (locale) => m.landingNavPricing({}, { locale })],
  ["contact", (locale) => m.landingNavContactLabel({}, { locale })],
  ["legal", (locale) => m.footerLegalLabel({}, { locale })],
  // The llms.txt format names this section: readers may skip what it lists.
  ["optional", () => "Optional"],
] as const satisfies ReadonlyArray<
  readonly [PublicPageTopic, (locale: Locale) => string]
>;

const pageUrl = (locale: Locale, pathname: PublicPagePathname) =>
  getWorkspaceAlternates(locale, pathname).canonical;

const pageLink = (pathname: PublicPagePathname): ListItem => {
  const languageLabels = getLanguageLabels(llmsTxtLocale);
  const otherLocales = locales.filter((locale) => locale !== llmsTxtLocale);

  return markdownListItem(
    markdownLink(
      pageUrl(llmsTxtLocale, pathname),
      publicPageMarkdown[pathname].title(llmsTxtLocale)
    ),
    ...otherLocales.flatMap((locale, index) => [
      index === 0 ? ": " : ", ",
      markdownLink(pageUrl(locale, pathname), languageLabels[locale]),
    ])
  );
};

/**
 * What a section lists after its pages, in the same list, so every bullet
 * stays a `-`: the contact email, or every offering under the prices.
 */
const sectionItems = (
  topic: PublicPageTopic,
  offerings: ReadonlyArray<PublicOffering>
): ListItem[] => {
  if (topic === "prices") {
    return publicOfferingsMarkdown(offerings, llmsTxtLocale).children;
  }
  if (topic !== "contact") return [];
  const { infoEmail } = workspaceSiteConstants.contact;
  return [
    markdownListItem(
      `${m.contactEmailLabel({}, { locale: llmsTxtLocale })}: `,
      markdownLink(`mailto:${infoEmail}`, infoEmail)
    ),
  ];
};

/**
 * `llms.txt` (https://llmstxt.org/): the business, a summary, the opening
 * hours, and its published public pages by topic, with the current prices.
 */
export const llmsTxtMarkdown = ({
  pages,
  offerings,
}: {
  /** The published public pages, in registry order. */
  readonly pages: ReadonlyArray<PublicPagePathname>;
  readonly offerings: ReadonlyArray<PublicOffering>;
}): MarkdownBlocks => [
  markdownHeading(1, workspaceSiteConstants.brand.name),
  markdownBlockquote(
    markdownParagraph(
      m.workspaceMetadataDescription({}, { locale: llmsTxtLocale })
    )
  ),
  markdownParagraph(getPublicOpeningHours(llmsTxtLocale)),
  ...topicSections.flatMap(([topic, heading]) => {
    const items = [
      ...pages
        .filter((pathname) => publicPageMarkdown[pathname].topic === topic)
        .map(pageLink),
      ...sectionItems(topic, offerings),
    ];
    return items.length > 0
      ? [markdownHeading(2, heading(llmsTxtLocale)), markdownList(items)]
      : [];
  }),
];
