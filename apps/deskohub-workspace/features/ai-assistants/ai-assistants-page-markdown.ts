import { Effect } from "effect";
import type { PhrasingContent } from "mdast";
import { getWorkspacePageUrl, type Locale } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownOrderedList,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import {
  type AiAssistantsGuideBlock,
  getAiAssistantsGuide,
} from "./ai-assistants-guide";

/** The AI assistants guide as Markdown, with absolute, locale-agnostic links. */
export const aiAssistantsPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> => {
  const guide = getAiAssistantsGuide(locale);
  const linkMapping = Object.fromEntries(
    Object.entries(guide.links).map(([name, href]) => [
      name,
      (content: PhrasingContent[]) =>
        markdownLink(
          href.startsWith("mailto:") ? href : getWorkspacePageUrl(href),
          ...content
        ),
    ])
  );
  const text = (template: string) => markdownInterpolate(template, linkMapping);

  const block = (guideBlock: AiAssistantsGuideBlock) => {
    switch (guideBlock.kind) {
      case "paragraph":
        return markdownParagraph(...text(guideBlock.text));
      case "steps":
        return markdownOrderedList(
          guideBlock.items.map((item) => markdownListItem(...text(item)))
        );
      case "list":
        return markdownList(
          guideBlock.items.map((item) => markdownListItem(...text(item)))
        );
      case "url":
        return markdownParagraph(markdownLink(guideBlock.url, guideBlock.url));
    }
  };

  return Effect.succeed([
    markdownHeading(1, guide.title),
    markdownParagraph(guide.lead),
    ...guide.sections.flatMap((section) => [
      markdownHeading(2, section.heading),
      ...section.blocks.map(block),
    ]),
  ]);
};
