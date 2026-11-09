/** The site's legal documents the Legal & Privacy screen links to, in order. */
export const legalDocuments = [
  "privacy",
  "marketing",
  "terms",
  "cookies",
] as const;
export type LegalDocument = (typeof legalDocuments)[number];

// The site's page paths without a locale prefix: the site redirects each to
// the reader's language.
const legalDocumentPath: Record<LegalDocument, string> = {
  privacy: "/privacy-policy",
  marketing: "/marketing-communications",
  terms: "/terms-and-conditions",
  cookies: "/cookie-policy",
};

/**
 * The locale-agnostic URL of a legal document on the Workspace the app talks
 * to, so a build pointed at a preview opens that preview's documents.
 */
export const legalDocumentUrl = (
  document: LegalDocument,
  siteOrigin: string
): string => new URL(legalDocumentPath[document], siteOrigin).href;
