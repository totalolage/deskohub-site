import { Effect } from "effect";
import type { PhrasingContent } from "mdast";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import type { PublicPageMarkdownSources } from "@/features/public-pages/public-page-markdown";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { loadFaqOccupancyStats } from "./backend/faq-occupancy.server";
import { faqAnswerLinkPaths, getFaqGroups } from "./faq-entries";

const answerLinks = Object.fromEntries(
  Object.entries(faqAnswerLinkPaths).map(([tag, path]) => [
    tag,
    (content: PhrasingContent[]) =>
      markdownLink(getWorkspacePageUrl(path), ...content),
  ])
);

/**
 * The FAQ page's topics, questions and answers as Markdown: each topic a
 * section with its questions under it.
 */
export const faqPageMarkdown = (
  locale: Locale,
  { isPublished }: Pick<PublicPageMarkdownSources, "isPublished">
): Effect.Effect<MarkdownBlocks> =>
  Effect.promise(loadFaqOccupancyStats).pipe(
    Effect.map((occupancy) => [
      markdownHeading(1, m.faqPageTitle({}, { locale })),
      ...getFaqGroups(locale, {
        occupancy,
        officesOffered: isPublished("/reservation/office"),
      }).flatMap((group) => [
        markdownHeading(2, group.title),
        ...group.entries.flatMap((entry) => [
          markdownHeading(3, entry.question),
          markdownParagraph(...markdownInterpolate(entry.answer, answerLinks)),
        ]),
      ]),
    ])
  );
