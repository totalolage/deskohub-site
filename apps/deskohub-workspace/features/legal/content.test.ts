import { describe, expect, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import { getCanonicalLegalDocument } from "./canonical-document";
import { getLegalDocument } from "./content";
import type { LegalDocumentKey } from "./legal-document-summaries";

const documentKeys = [
  "terms-and-conditions",
  "privacy-policy",
  "cookie-policy",
  "operating-rules",
  "marketing-communications",
] as const satisfies ReadonlyArray<LegalDocumentKey>;

type CanonicalSections = {
  readonly sections: ReadonlyArray<{ readonly body: ReadonlyArray<string> }>;
};

const sectionNumbers = (locale: Locale, documentKey: LegalDocumentKey) =>
  getLegalDocument(locale, documentKey).sections.map(
    ({ heading }) => heading.split(".")[0]
  );

describe.each(documentKeys)("%s", (documentKey) => {
  test("every locale numbers its sections 1 to n in order", () => {
    for (const locale of locales) {
      const numbers = sectionNumbers(locale, documentKey);
      expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));
    }
  });

  test("every locale has the governing Czech text's sections", () => {
    const czechCount = sectionNumbers("cs-CZ", documentKey).length;
    for (const locale of locales) {
      expect(sectionNumbers(locale, documentKey)).toHaveLength(czechCount);
    }
  });

  test("every locale has the governing Czech text's numbered clauses", () => {
    const clauseNumbers = (locale: Locale) => {
      const canonical: CanonicalSections = JSON.parse(
        getCanonicalLegalDocument(getLegalDocument(locale, documentKey))
      );
      return canonical.sections.map(({ body }) =>
        body.flatMap((paragraph) => paragraph.match(/^\d+\.\d+(?=\s)/) ?? [])
      );
    };
    const czech = clauseNumbers("cs-CZ");
    for (const locale of locales) {
      expect(clauseNumbers(locale)).toEqual(czech);
    }
  });
});

describe("translation notice", () => {
  test("the governing Czech text carries none", () => {
    for (const documentKey of documentKeys) {
      expect(
        getLegalDocument("cs-CZ", documentKey).translationNotice
      ).toBeUndefined();
    }
  });

  test("every translation carries one notice in every document", () => {
    for (const locale of locales.filter((locale) => locale !== "cs-CZ")) {
      const notices = documentKeys.map(
        (documentKey) => getLegalDocument(locale, documentKey).translationNotice
      );
      expect(notices[0]?.trim()).toBeTruthy();
      expect(new Set(notices).size).toBe(1);
    }
  });
});
