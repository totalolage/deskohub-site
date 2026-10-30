import { createHash } from "node:crypto";
import type { Locale } from "@/features/i18n";
import { getCanonicalLegalDocument } from "./canonical-document";
import { getLegalDocument, type LegalDocumentContent } from "./content";
import type { LegalDocumentKey } from "./legal-document-summaries";

export const legalDocumentHashAlgorithm = "sha256";

/**
 * Hashes a legal document's canonical form. The hash is the document's
 * version: any change to its title, lead, date, or text gives a new one, and
 * stored consents and legal evidence record it.
 */
export function hashLegalDocument(document: LegalDocumentContent): string {
  return createHash(legalDocumentHashAlgorithm)
    .update(getCanonicalLegalDocument(document))
    .digest("hex");
}

export function getLegalDocumentPath(
  locale: Locale,
  documentKey: LegalDocumentKey
): string {
  return `/${locale}/${documentKey}`;
}

const documentVersions = new Map<string, string>();

/** The current version of the published document, hashed once per process. */
export function getLegalDocumentVersion(
  locale: Locale,
  documentKey: LegalDocumentKey
): string {
  const path = getLegalDocumentPath(locale, documentKey);
  const cached = documentVersions.get(path);
  if (cached !== undefined) {
    return cached;
  }

  const version = hashLegalDocument(getLegalDocument(locale, documentKey));
  documentVersions.set(path, version);
  return version;
}
