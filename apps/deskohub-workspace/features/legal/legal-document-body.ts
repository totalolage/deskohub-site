import type { ReactNode } from "react";
import type { LegalDocumentKey } from "./legal-document-summaries";

export type LegalSection = {
  heading: string;
  body: ReactNode[];
};

export type LegalDocumentBody = {
  updatedAt: string;
  sections: LegalSection[];
};

/** One locale's text of every legal document. */
export type LegalDocumentBodies = Record<LegalDocumentKey, LegalDocumentBody>;

/**
 * A locale's translation of the governing Czech documents. Its notice, shown
 * with every document, states that the Czech text governs on any
 * discrepancy.
 */
export type LegalDocumentTranslation = {
  readonly translationNotice: string;
  readonly documents: LegalDocumentBodies;
};
