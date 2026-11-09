import type { ListItem } from "mdast";
import {
  type AgentInterfaces,
  agentInterfacesMarkdown,
} from "@/features/agent-tools/agent-interfaces-markdown";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import { publicOfferingsMarkdown } from "@/features/checkout/public-offerings-markdown";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
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
import { publicPageDefinitions } from "./public-page-definitions";
import {
  type PublicPageTopic,
  publicPageMarkdown,
} from "./public-page-markdown";
import type { PublicPagePathname } from "./public-pages";
import { getWorkspaceSummary } from "./workspace-summary";

/**
 * `llms.txt` is written in English and links each page by its locale-agnostic
 * URL, which opens in the reader's language.
 */
export const llmsTxtLocale: Locale = "en-US";

type TopicSection = readonly [PublicPageTopic, (locale: Locale) => string];

/** Page sections in the order `llms.txt` lists them, with their headings. */
const topicSections = [
  ["offer", (locale) => m.publicPageTopicOffer({}, { locale })],
  ["booking", (locale) => m.publicPageTopicBooking({}, { locale })],
  ["prices", (locale) => m.landingNavPricing({}, { locale })],
  ["contact", (locale) => m.landingNavContactLabel({}, { locale })],
  ["legal", (locale) => m.footerLegalLabel({}, { locale })],
] as const satisfies ReadonlyArray<TopicSection>;

// The llms.txt format names this section: readers may skip what it lists.
// It comes last.
const optionalSection: TopicSection = ["optional", () => "Optional"];

const pageLink = (pathname: PublicPagePathname): ListItem =>
  markdownListItem(
    markdownLink(
      getWorkspacePageUrl(pathname),
      publicPageDefinitions[pathname].title({}, { locale: llmsTxtLocale })
    )
  );

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

/** A topic's section: its heading and list, or nothing without items. */
const topicSectionBlocks =
  (
    pages: ReadonlyArray<PublicPagePathname>,
    offerings: ReadonlyArray<PublicOffering>
  ) =>
  ([topic, heading]: TopicSection): MarkdownBlocks => {
    const items = [
      ...pages
        .filter((pathname) => publicPageMarkdown[pathname].topic === topic)
        .map(pageLink),
      ...sectionItems(topic, offerings),
    ];
    return items.length > 0
      ? [markdownHeading(2, heading(llmsTxtLocale)), markdownList(items)]
      : [];
  };

/**
 * `llms.txt` (https://llmstxt.org/): the business, a summary, the opening
 * hours, its published public pages by topic with the current prices, and
 * the agent interfaces.
 */
export const llmsTxtMarkdown = ({
  pages,
  offerings,
  agentInterfaces,
}: {
  /** The published public pages, in registry order. */
  readonly pages: ReadonlyArray<PublicPagePathname>;
  readonly offerings: ReadonlyArray<PublicOffering>;
  readonly agentInterfaces: AgentInterfaces;
}): MarkdownBlocks => [
  markdownHeading(1, workspaceSiteConstants.brand.name),
  markdownBlockquote(
    markdownParagraph(getWorkspaceSummary({ locale: llmsTxtLocale, offerings }))
  ),
  markdownParagraph(getPublicOpeningHours(llmsTxtLocale)),
  ...topicSections.flatMap(topicSectionBlocks(pages, offerings)),
  ...agentInterfacesMarkdown(agentInterfaces),
  ...topicSectionBlocks(pages, offerings)(optionalSection),
];
