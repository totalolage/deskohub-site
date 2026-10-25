import { describe, expect, test } from "bun:test";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getCanonicalLegalDocument } from "./canonical-document";
import { getLegalDocument } from "./content";
import type { LegalDocumentKey } from "./legal-document-summaries";
import { legalPageMarkdown } from "./legal-page-markdown";

const documentKeys = [
  "terms-and-conditions",
  "privacy-policy",
  "cookie-policy",
  "operating-rules",
  "marketing-communications",
] as const satisfies ReadonlyArray<LegalDocumentKey>;

type CanonicalLegalDocument = {
  readonly title: string;
  readonly lead: string;
  readonly updatedAt: string;
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    readonly body: ReadonlyArray<string>;
  }>;
};

const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

describe.each(locales)("legalPageMarkdown in %s", (locale) => {
  test.each(documentKeys)(
    "%s matches the canonical legal document text",
    (documentKey) => {
      const canonical: CanonicalLegalDocument = JSON.parse(
        getCanonicalLegalDocument(getLegalDocument(locale, documentKey))
      );
      const expectedLines = [
        canonical.title,
        canonical.lead,
        `${m.legalPageLastUpdatedLabel({}, { locale })}: ${canonical.updatedAt}`,
        ...canonical.sections.flatMap(({ heading, body }) => [
          heading,
          ...body,
        ]),
      ]
        .map(collapseWhitespace)
        .filter(Boolean);

      const markdown = serializeMarkdown(
        legalPageMarkdown(locale, documentKey)
      );

      expect(markdownPlainText(markdown)).toBe(expectedLines.join("\n"));
    }
  );

  test("links every anchor to its absolute, locale-agnostic target", () => {
    const urls = documentKeys.flatMap((documentKey) =>
      markdownLinkUrls(
        serializeMarkdown(legalPageMarkdown(locale, documentKey))
      )
    );

    expect(urls).toContain(
      `mailto:${workspaceSiteConstants.contact.infoEmail}`
    );
    expect(urls).toContain("https://workspace.deskohub.cz/privacy-policy");
    for (const url of urls) {
      expect(url).toMatch(/^(https:\/\/|mailto:)/);
      if (!url.startsWith("https://workspace.deskohub.cz/")) continue;
      for (const pageLocale of locales) {
        expect(new URL(url).pathname.split("/")).not.toContain(pageLocale);
      }
    }
  });
});
