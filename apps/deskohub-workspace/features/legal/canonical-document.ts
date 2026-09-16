import { Predicate } from "effect";
import { Children, isValidElement, type ReactNode } from "react";
import type { LegalDocumentContent } from "./content";

function reactNodeToCanonicalText(node: ReactNode): string {
  if (node === null || node === undefined || Predicate.isBoolean(node)) {
    return "";
  }

  if (Predicate.isString(node) || Predicate.isNumber(node)) {
    return String(node);
  }

  if (Array.isArray(node)) {
    return Children.toArray(node).map(reactNodeToCanonicalText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodeToCanonicalText(node.props.children);
  }

  return "";
}

export function getCanonicalLegalDocument(
  document: LegalDocumentContent
): string {
  return JSON.stringify({
    title: document.title,
    lead: document.lead,
    updatedAt: document.updatedAt,
    sections: document.sections.map((section) => ({
      heading: section.heading,
      body: section.body.map(reactNodeToCanonicalText),
    })),
  });
}
