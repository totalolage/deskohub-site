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
      "53e796ba06229ee4d8e9500c3045178a27113df99b1d708dd59c11a3134fb7e5",
    "cookie-policy":
      "476c15e027bde0e04823024f02842b5652456a9721680f0efd0dabf9d494fd03",
  },
  "cs-CZ": {
    "privacy-policy":
      "8a2a8f97a98f550859993a6c0884422796d86310d054b85198c2cea5aaaf7597",
    "cookie-policy":
      "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
  "de-DE": {
    "privacy-policy":
      "d219cb484f33adc57361b289f7f4c009420caef00b51894d73aff55af2c85c0f",
    "cookie-policy":
      "6812034325d23d8f848a4fb64f09d8aa014d62cc7d3addc45759c1fb075fc486",
  },
  "uk-UA": {
    "privacy-policy":
      "f4fa60c6d8dff580e3cd048c64badeeb1f390344fc2f48d1fb90e5440e910daa",
    "cookie-policy":
      "08480393eeeadb3cbc83b2cdd9be368d03eb1f96a2156c4d5cf064ee7c656d00",
  },
  "sk-SK": {
    "privacy-policy":
      "7e12903683052ab508bbbb50228988cf06dacc872431f21506f8b6a4c8e5f3fb",
    "cookie-policy":
      "d9cc345892616de3c3b05e7e1f7e505a7947738423b2ee4276d0757f3d4dbfaf",
  },
  "vi-VN": {
    "privacy-policy":
      "89898a2e9b0b8ff9873d44e48c0d13c5dade1d79f91f9dc58de79bd46b918795",
    "cookie-policy":
      "d1a469bc79c9be640a99e42a1266b825ad10e543c7895526567d9207c4f2dd92",
  },
  "hi-IN": {
    "privacy-policy":
      "db35770c2e282d1d15ce49251eebfba87b6d75e6b2b7d838e4882c5c62960c13",
    "cookie-policy":
      "8a1b1ac6543ec1b2a5d9ab7188e86679699a29fe1910e762bfa8a1a151ed6bad",
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
