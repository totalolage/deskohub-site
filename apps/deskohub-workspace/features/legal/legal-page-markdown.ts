import { type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getLegalDocument } from "./content";
import type { LegalDocumentKey } from "./legal-document-summaries";
import { legalNodeToPhrasing } from "./legal-node-phrasing";

/** A legal page as Markdown, from the same document its HTML page renders. */
export const legalPageMarkdown = (
  locale: Locale,
  documentKey: LegalDocumentKey
): MarkdownBlocks => {
  const document = getLegalDocument(locale, documentKey);

  return [
    markdownHeading(1, document.title),
    markdownParagraph(document.lead),
    markdownParagraph(
      `${m.legalPageLastUpdatedLabel({}, { locale })}: ${document.updatedAt}`
    ),
    ...document.sections.flatMap((section) => [
      markdownHeading(2, section.heading),
      ...section.body.map((paragraph) =>
        markdownParagraph(...legalNodeToPhrasing(paragraph))
      ),
    ]),
  ];
};
