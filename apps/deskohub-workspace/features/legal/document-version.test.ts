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
    version: "5447e6b7a9e983ec4ee772884bb63e65add6a451d5084bf3db9eaee5522afe70",
  },
  {
    locale: "en-US",
    documentKey: "marketing-communications",
    version: "75655dda4406b51fd74d1151a8d28443b75e580728c203cef54c2483ec3ed02d",
  },
  {
    locale: "en-US",
    documentKey: "cookie-policy",
    version: "6f6dfe905178428e2e533ac26de8116e4f222993a585a727b188d9cbae184e2e",
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
    version: "a991131f5c50fc56f30b0bb34666105c190b136b000f60ca76fd1eedac6eb319",
  },
  {
    locale: "cs-CZ",
    documentKey: "marketing-communications",
    version: "3bbaa65156c221b8bf97b74a93c11830fb4f73cbbcd5d144932c51d6b71b4cb7",
  },
  {
    locale: "cs-CZ",
    documentKey: "cookie-policy",
    version: "df94429ec4cff84e40d74624d28b509367a55535d9a23287a749ee395d31d49c",
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
