import type { Metadata } from "next";
import { getWorkspaceAlternates, type Locale } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import { workspaceSiteConstants } from "@/shared/utils";

export function createLegalMetadata(
  locale: Locale,
  documentKey: LegalDocumentKey
): Metadata {
  const document = getLegalDocument(locale, documentKey);
  const alternates = getWorkspaceAlternates(locale, documentKey);

  return {
    title: `${document.title} | ${workspaceSiteConstants.brand.name}`,
    description: document.lead,
    alternates,
    openGraph: {
      title: document.title,
      description: document.lead,
      url: alternates.canonical,
      siteName: workspaceSiteConstants.brand.name,
      locale,
      type: "article",
    },
  } satisfies Metadata;
}
