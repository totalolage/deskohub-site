import type { Metadata, ResolvingMetadata } from "next";
import type { Locale } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

export function createLegalMetadata(
  locale: Locale,
  documentKey: LegalDocumentKey,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const document = getLegalDocument(locale, documentKey);

  return createPublicPageMetadata(
    {
      locale,
      pathname: documentKey,
      title: { page: document.title },
      description: document.lead,
      type: "article",
    },
    parent
  );
}
