import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { loadFaqOccupancyStats } from "./backend/faq-occupancy.server";
import { getFaqEntries } from "./faq-entries";

/** The FAQ page's questions and answers as Markdown, each question a section. */
export const faqPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.promise(loadFaqOccupancyStats).pipe(
    Effect.map((occupancy) => [
      markdownHeading(1, m.faqPageTitle({}, { locale })),
      ...getFaqEntries(locale, occupancy).flatMap((entry) => [
        markdownHeading(2, entry.question),
        markdownParagraph(entry.answer),
      ]),
    ])
  );
