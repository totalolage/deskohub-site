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
    version: "94c5ab326bd014146ce95e7408885c33fe563821877ad507f8dd512ef4388b1a",
  },
  {
    locale: "en-US",
    documentKey: "operating-rules",
    version: "e1d0be9cf7391fbcbd96a11b5bc8a4ef527abec495e323a16f67e10b3b6a64af",
  },
  {
    locale: "en-US",
    documentKey: "privacy-policy",
    version: "d6ce494a0f95e212c2ec4408ec3e7c1248aec37ae93fd2c03f383344449bc8dc",
  },
  {
    locale: "en-US",
    documentKey: "marketing-communications",
    version: "75655dda4406b51fd74d1151a8d28443b75e580728c203cef54c2483ec3ed02d",
  },
  {
    locale: "en-US",
    documentKey: "cookie-policy",
    version: "29ac7ca092e54b93689e777f2a6d4dec4a07746d4ad9f7e46be86c14bc1a3450",
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
    version: "60a932f787e257e58573ac3764974a3c4b362dd418b3e1535f20b11a76ae8da0",
  },
  {
    locale: "cs-CZ",
    documentKey: "marketing-communications",
    version: "3bbaa65156c221b8bf97b74a93c11830fb4f73cbbcd5d144932c51d6b71b4cb7",
  },
  {
    locale: "cs-CZ",
    documentKey: "cookie-policy",
    version: "7cd5562413ba11f8d4ad190ad5b90e893d67edb13e49a622a0c28b1bc5ae7593",
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
