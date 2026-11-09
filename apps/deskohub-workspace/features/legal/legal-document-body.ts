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
