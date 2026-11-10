import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { languageNameFontProperty, languageNameStyle } from "./language-labels";

describe("language name style", () => {
  test("leaves Latin-script names in the page's face", () => {
    for (const locale of supportedLocales.filter(
      (locale) => getLocaleDefinition(locale).script === "latin"
    )) {
      expect(languageNameStyle(locale)).toBeUndefined();
    }
  });

  test("sets other names in their name face ahead of the page's text stack", () => {
    const otherScripts = supportedLocales.filter(
      (locale) => getLocaleDefinition(locale).script !== "latin"
    );

    expect(otherScripts).toContain("hi-IN");
    for (const locale of otherScripts) {
      expect(languageNameStyle(locale)).toEqual({
        fontFamily: `var(${languageNameFontProperty(locale)}), var(--font-body)`,
      });
    }
  });
});
