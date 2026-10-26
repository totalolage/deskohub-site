import { Effect } from "effect";
import {
  getUnprefixedPagePath,
  getWorkspacePageUrl,
  type Locale,
  m,
} from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getTeamFounders } from "./team-founders";

/**
 * The team page as Markdown: the story, then each founder a section under
 * their role. A censored founder's name stays out, as the page hides it.
 */
export const teamPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.succeed([
    markdownHeading(1, m.landingFoundersTitle({}, { locale })),
    markdownParagraph(m.teamAboutLead({}, { locale })),
    markdownParagraph(
      ...markdownInterpolate(m.teamAboutBody({}, { locale }), {
        contact: (content) =>
          markdownLink(
            getWorkspacePageUrl(getUnprefixedPagePath("/[locale]/contact")),
            ...content
          ),
      })
    ),
    ...getTeamFounders(locale).flatMap((founder) => [
      markdownHeading(2, founder.role),
      ...(founder.name ? [markdownParagraph(founder.name)] : []),
      markdownParagraph(founder.description),
    ]),
  ]);
