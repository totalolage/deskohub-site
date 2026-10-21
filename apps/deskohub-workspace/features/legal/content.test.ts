import { describe, expect, test } from "bun:test";
import { type Locale, locales } from "@/features/i18n";
import { getLegalDocument } from "./content";

const sectionNumbers = (locale: Locale) =>
  getLegalDocument(locale, "privacy-policy").sections.map(
    ({ heading }) => heading.split(".")[0]
  );

describe("privacy policy", () => {
  test("every locale numbers its sections 1 to n in order", () => {
    for (const locale of locales) {
      const numbers = sectionNumbers(locale);
      expect(numbers).toEqual(numbers.map((_, index) => String(index + 1)));
    }
  });

  test("every locale has the same number of sections", () => {
    const counts = locales.map((locale) => sectionNumbers(locale).length);
    expect(new Set(counts).size).toBe(1);
  });
});
