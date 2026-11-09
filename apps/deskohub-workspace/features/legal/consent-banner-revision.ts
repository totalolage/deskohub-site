import { createHash } from "node:crypto";
import { type Locale, locales } from "@/features/i18n";
import type { LegalDocumentKey } from "./legal-document-summaries";

/** The documents a cookie consent choice is made under. */
const consentBannerDocuments = [
  "privacy-policy",
  "cookie-policy",
] as const satisfies readonly LegalDocumentKey[];

type ConsentBannerDocument = (typeof consentBannerDocuments)[number];

/**
 * The published version (`getLegalDocumentVersion`) of each document the
 * banner is bound to, per locale whose legal documents are published. A copy,
 * so the server's consent cookie readers, which every request loads, never
 * load the legal texts or React; a test fails with the current versions
 * whenever either document changes in any locale.
 *
 * Recording a new locale's versions here changes the banner revision, which
 * reopens the cookie banner for every visitor.
 */
export const consentBannerDocumentVersions: Readonly<
  Partial<Record<Locale, Readonly<Record<ConsentBannerDocument, string>>>>
> = {
  "en-US": {
    "privacy-policy":
      "d783addd2d40a3221f65c18a560d29c9caf2eadbe677315b9e204c1b08d3c357",
    "cookie-policy":
      "b5b9dbefd033c1e03fadf088aadab6e2081a518f4d09d9a4f3bc833dae1a5b07",
  },
  "cs-CZ": {
    "privacy-policy":
      "8a2a8f97a98f550859993a6c0884422796d86310d054b85198c2cea5aaaf7597",
    "cookie-policy":
      "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
};

const publishedVersionOf = (
  locale: Locale,
  documentKey: ConsentBannerDocument
): string | undefined => consentBannerDocumentVersions[locale]?.[documentKey];

/**
 * The cookie banner revision of the privacy notice and cookie policy in every
 * locale: a positive safe integer that changes whenever either document
 * changes in any locale, which invalidates every saved consent choice and
 * reopens the banner. Switching the site language never changes it. Never 0,
 * the revision every consent cookie saved before the banner was bound to the
 * documents carries. `versionOf` defaults to the published versions.
 */
export function getConsentBannerRevision(
  versionOf: (
    locale: Locale,
    documentKey: ConsentBannerDocument
  ) => string | undefined = publishedVersionOf
): number {
  // Only locales with recorded versions count, in registry order.
  const versions = locales.flatMap((locale) =>
    consentBannerDocuments.flatMap((documentKey) => {
      const version = versionOf(locale, documentKey);
      return version === undefined ? [] : [version];
    })
  );
  const digest = createHash("sha256").update(versions.join("\n")).digest("hex");
  // 48 bits stay well inside Number.MAX_SAFE_INTEGER.
  return Number.parseInt(digest.slice(0, 12), 16) || 1;
}
