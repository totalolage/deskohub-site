import { describe, expect, test } from "bun:test";
import { getLocaleDefinition } from "@deskohub/i18n/locale-registry";
import { toHostedPageLanguage } from "./hosted-page-language";

describe("toHostedPageLanguage", () => {
  test("sends a language Nexi offers in the contract's uppercase form", () => {
    expect(toHostedPageLanguage("cze")).toBe("CZE");
    expect(toHostedPageLanguage("eng")).toBe("ENG");
    expect(toHostedPageLanguage("deu")).toBe("DEU");
    expect(toHostedPageLanguage("slk")).toBe("SLK");
  });

  test("shows English for a language Nexi doesn't offer", () => {
    expect(toHostedPageLanguage("ukr")).toBe("ENG");
  });

  test("shows each supported locale's hosted page language", () => {
    for (const [locale, language] of [
      ["cs-CZ", "CZE"],
      ["en-US", "ENG"],
      ["de-DE", "DEU"],
      ["sk-SK", "SLK"],
      // Nexi offers no Ukrainian, Vietnamese or Hindi.
      ["uk-UA", "ENG"],
      ["vi-VN", "ENG"],
      ["hi-IN", "ENG"],
    ] as const) {
      expect(
        toHostedPageLanguage(getLocaleDefinition(locale).nexiLanguage)
      ).toBe(language);
    }
  });
});
