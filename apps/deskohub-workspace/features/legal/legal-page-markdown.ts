import { Predicate } from "effect";
import type { PhrasingContent } from "mdast";
import { Children, isValidElement, type ReactNode } from "react";
import { getWorkspacePageUrl, type Locale, m } from "@/features/i18n";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownLink,
  markdownParagraph,
  markdownText,
} from "@/shared/markdown/markdown";
import { getLegalDocument } from "./content";
import type { LegalDocumentKey } from "./legal-document-summaries";

type LegalElementProps = {
  readonly children?: ReactNode;
  readonly href?: string;
};

// Same-site links are written as paths, some with a locale; Markdown readers
// need the full, locale-agnostic URL.
const absoluteHref = (href: string) =>
  href.startsWith("/") ? getWorkspacePageUrl(href) : href;

/**
 * The authored legal body as Markdown phrasing: text stays text and an
 * anchor becomes a link to its target. Any other element contributes its
 * children, as `getCanonicalLegalDocument` reads them.
 */
const legalNodeToPhrasing = (node: ReactNode): PhrasingContent[] => {
  if (node === null || node === undefined || Predicate.isBoolean(node)) {
    return [];
  }
  if (Predicate.isString(node) || Predicate.isNumber(node)) {
    return [markdownText(String(node))];
  }
  if (Array.isArray(node)) {
    return Children.toArray(node).flatMap(legalNodeToPhrasing);
  }
  if (isValidElement<LegalElementProps>(node)) {
    const children = legalNodeToPhrasing(node.props.children);
    return node.type === "a" && node.props.href
      ? [markdownLink(absoluteHref(node.props.href), ...children)]
      : children;
  }
  return [];
};

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
