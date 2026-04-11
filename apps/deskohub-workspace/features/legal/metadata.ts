import type { Metadata } from "next";
import type { WorkspaceLocale } from "@/features/i18n";
import { workspaceLocales } from "@/features/i18n";
import { getLegalDocument, type LegalDocumentKey } from "@/features/legal";
import { workspaceSiteConstants } from "@/shared/utils";

export function createLegalMetadata(
  locale: WorkspaceLocale,
  documentKey: LegalDocumentKey
): Metadata {
  const document = getLegalDocument(locale, documentKey);
  const url = `https://${workspaceSiteConstants.brand.domain}/${locale}/${documentKey}`;

  return {
    title: `${document.title} | ${workspaceSiteConstants.brand.name}`,
    description: document.lead,
    alternates: {
      canonical: url,
      languages: Object.fromEntries(
        workspaceLocales.map((itemLocale) => [
          itemLocale,
          `https://${workspaceSiteConstants.brand.domain}/${itemLocale}/${documentKey}`,
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
