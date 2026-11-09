import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { Locale } from "@/features/i18n";
import { getLegalDocument } from "./content";
import { getLegalDocumentVersion, hashLegalDocument } from "./document-version";
import type { LegalDocumentKey } from "./legal-document-summaries";

// Versions of the published documents. Stored consents and legal evidence
// record them, so a change here must come from an intended document change.
const publishedDocuments: ReadonlyArray<{
  readonly locale: Locale;
  readonly documentKey: LegalDocumentKey;
  readonly version: string;
}> = [
  {
    locale: "en-US",
    documentKey: "terms-and-conditions",
    version: "d56d9e83196b802aee01393512cff46d0fef6e01449c72b229db535b0bf095c6",
  },
  {
    locale: "en-US",
    documentKey: "operating-rules",
    version: "05cefdd98d32159cfce228b230931f9cc257643d90f83f327589732476c8ba56",
  },
  {
    locale: "en-US",
    documentKey: "privacy-policy",
    version: "53e796ba06229ee4d8e9500c3045178a27113df99b1d708dd59c11a3134fb7e5",
  },
  {
    locale: "en-US",
    documentKey: "marketing-communications",
    version: "3aa139f0b2a187e4d7bd7e488174b03c8e43b4a893d221b8527ed8e58db31653",
  },
  {
    locale: "en-US",
    documentKey: "cookie-policy",
    version: "476c15e027bde0e04823024f02842b5652456a9721680f0efd0dabf9d494fd03",
  },
  {
    locale: "cs-CZ",
    documentKey: "terms-and-conditions",
    version: "efa8ecfc37e738c1602de72de081f71cb97ca2ba8b194db9f4938071353b86dd",
  },
  {
    locale: "cs-CZ",
    documentKey: "operating-rules",
    version: "72c29525579c9f6bf1628e409da40b9bd6f620acfa9f2623198f7bbc73f4df77",
  },
  {
    locale: "cs-CZ",
    documentKey: "privacy-policy",
    version: "8a2a8f97a98f550859993a6c0884422796d86310d054b85198c2cea5aaaf7597",
  },
  {
    locale: "cs-CZ",
    documentKey: "marketing-communications",
    version: "3bbaa65156c221b8bf97b74a93c11830fb4f73cbbcd5d144932c51d6b71b4cb7",
  },
  {
    locale: "cs-CZ",
    documentKey: "cookie-policy",
    version: "9e1622d98ffc2f8879400494842ee8e2ee3f096a5e023636388c65c220dc3801",
  },
];

describe("getLegalDocumentVersion", () => {
  test.each(publishedDocuments)(
    "versions $locale $documentKey by its content hash",
    ({ locale, documentKey, version }) => {
      expect(getLegalDocumentVersion(locale, documentKey)).toBe(version);
      expect(getLegalDocumentVersion(locale, documentKey)).toBe(version);
    }
  );
});

describe("hashLegalDocument", () => {
  test.each(publishedDocuments)(
    "hashes $locale $documentKey to its published version",
    ({ locale, documentKey, version }) => {
      expect(hashLegalDocument(getLegalDocument(locale, documentKey))).toBe(
        version
      );
    }
  );

  test("gives a changed document a new version", () => {
    const document = getLegalDocument("en-US", "marketing-communications");

    expect(
      hashLegalDocument({ ...document, updatedAt: `${document.updatedAt}.` })
    ).not.toBe(getLegalDocumentVersion("en-US", "marketing-communications"));
  });
});
