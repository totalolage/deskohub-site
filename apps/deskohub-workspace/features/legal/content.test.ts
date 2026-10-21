import { describe, expect, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { markdownLinkUrls } from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getLegalDocument } from "./content";
import { legalPageMarkdown } from "./legal-page-markdown";

const sectionNumbers = (locale: Locale) =>
  getLegalDocument(locale, "privacy-policy").sections.map(
    ({ heading }) => heading.split(".")[0]
  );

describe("privacy policy", () => {
  test("every locale has the same numbered sections in order", () => {
    const expected = ["1", "2", "3", "4", "5", "6", "7", "8"];
    for (const locale of locales) {
      expect(sectionNumbers(locale)).toEqual(expected);
    }
  });

  test.each(locales)(
    "%s tells customers how to ask about transfers outside the EU",
    (locale) => {
      const transfers = serializeMarkdown(
        legalPageMarkdown(locale, "privacy-policy")
      )
        .split(/^#+ /m)
        .find((section) => section.startsWith("7. "));

      expect(transfers).toBeDefined();
      expect(markdownLinkUrls(transfers ?? "")).toEqual([
        `mailto:${workspaceSiteConstants.contact.infoEmail}`,
      ]);
    }
  );
});
