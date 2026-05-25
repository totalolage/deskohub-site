import type { Metadata } from "next";
import type { Locale } from "@/features/i18n";
import { locales } from "@/features/i18n";
import {
  getLegalDocument,
  type LegalDocumentKey,
} from "@/features/legal/content";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

export function createLegalMetadata(
  locale: Locale,
  documentKey: LegalDocumentKey
): Metadata {
  const document = getLegalDocument(locale, documentKey);
  const url = getWorkspaceLocalizedCanonicalUrl(locale, documentKey);

  return {
    title: `${document.title} | ${workspaceSiteConstants.brand.name}`,
    description: document.lead,
    alternates: {
      canonical: url,
      languages: Object.fromEntries(
        locales.map((itemLocale) => [
          itemLocale,
          getWorkspaceLocalizedCanonicalUrl(itemLocale, documentKey),
        ])
      ),
    },
    openGraph: {
      title: document.title,
      description: document.lead,
      url,
      siteName: workspaceSiteConstants.brand.name,
      locale,
      type: "article",
    },
  } satisfies Metadata;
}
