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
      "8287dd4ab0fbb05d935b385b6967469a7b851ef6111914eda1da8856f8e3f00d",
    "cookie-policy":
      "476c15e027bde0e04823024f02842b5652456a9721680f0efd0dabf9d494fd03",
  },
  "cs-CZ": {
    "privacy-policy":
      "3f73bb4e80c2336af605403602a15251567f5fb06be6790cf9dc906a7dc68bad",
    "cookie-policy":
      "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
  "de-DE": {
    "privacy-policy":
      "438e3c9c79bda5bb45ea4f4c064c2c29cabdfd0bc3bbde23070667132c2beed2",
    "cookie-policy":
      "6812034325d23d8f848a4fb64f09d8aa014d62cc7d3addc45759c1fb075fc486",
  },
  "uk-UA": {
    "privacy-policy":
      "1a36356104a1b91a08e55bae6510979b5f3fd2204959471b3716169c3ebbced3",
    "cookie-policy":
      "08480393eeeadb3cbc83b2cdd9be368d03eb1f96a2156c4d5cf064ee7c656d00",
  },
  "sk-SK": {
    "privacy-policy":
      "ee81e8d637535fc797c9b5207c9f383d9fdfc7e4fa8aad4900bccf101a77df02",
    "cookie-policy":
      "d9cc345892616de3c3b05e7e1f7e505a7947738423b2ee4276d0757f3d4dbfaf",
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
