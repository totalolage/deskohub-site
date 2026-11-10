import { describe, expect, test } from "bun:test";
import { locales } from "@/features/i18n";
import { discountLabelFor } from "./discount-label";

const labels = { "en-US": "Summer sale", "cs-CZ": "Letní sleva" } as const;

describe("discountLabelFor", () => {
  test("reads a locale's own label where operators write one", () => {
    expect(discountLabelFor(labels, "en-US")).toBe("Summer sale");
    expect(discountLabelFor(labels, "cs-CZ")).toBe("Letní sleva");
  });

  test("reads another locale's label through the locale's fallback chain", () => {
    expect(discountLabelFor(labels, "de-DE")).toBe("Summer sale");
    expect(discountLabelFor(labels, "uk-UA")).toBe("Summer sale");
    expect(discountLabelFor(labels, "sk-SK")).toBe("Letní sleva");
  });

  test("finds a label for every locale", () => {
    for (const locale of locales) {
      expect(Object.values(labels)).toContain(discountLabelFor(labels, locale));
    }
  });
});
