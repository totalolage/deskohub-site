import { Effect } from "effect";
import { type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getTeamFounders } from "./team-founders";

/**
 * The team page's founders as Markdown, each founder a section under their
 * role. A censored founder's name stays out, as the page hides it.
 */
export const teamPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(1, m.landingFoundersTitle({}, { locale })),
    ...getTeamFounders(locale).flatMap((founder) => [
      markdownHeading(2, founder.role),
      ...(founder.name ? [markdownParagraph(founder.name)] : []),
      markdownParagraph(founder.description),
    ]),
  ]);
