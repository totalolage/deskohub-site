import { describe, expect, mock, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { nextFontLocal } from "@/shared/testing/next-font-local.test-utils";

mock.module("next/font/local", () => nextFontLocal);

const { getLocaleFontStyle, languageNameFontStyle } = await import(
  "./locale-fonts"
);

const brandFamilies = "'sculpin', 'sculpin Fallback'";
const fonts = "'../../assets/fonts";

describe("locale font style", () => {
  test("leaves Latin-script pages on the brand families alone", () => {
    const latinLocales = supportedLocales.filter(
      (locale) => getLocaleDefinition(locale).script === "latin"
    );

    expect(latinLocales).toContain("cs-CZ");
    for (const locale of latinLocales) {
      expect(getLocaleFontStyle(locale, brandFamilies)).toBeUndefined();
    }
  });

  test("puts Montserrat's Cyrillic between Sculpin and its fallback on Ukrainian pages", () => {
    expect(getLocaleFontStyle("uk-UA", brandFamilies)).toEqual({
      "--font-text": `'sculpin', ${fonts}/Montserrat/cyrillic.woff2', 'sculpin Fallback'`,
    });
  });

  test("sets Vietnamese pages in Montserrat ahead of Sculpin", () => {
    expect(getLocaleFontStyle("vi-VN", brandFamilies)).toEqual({
      "--font-text": `${fonts}/Montserrat/vietnamese.woff2', ${fonts}/Montserrat/latin-ext.woff2', 'sculpin', 'sculpin Fallback'`,
    });
  });

  test("puts Poppins' Devanagari and the system Devanagari fonts between Sculpin and its fallback on Hindi pages", () => {
    expect(getLocaleFontStyle("hi-IN", brandFamilies)).toEqual({
      "--font-text": `'sculpin', ${fonts}/Poppins/devanagari-400.woff2', "Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", 'sculpin Fallback'`,
    });
  });
});

describe("language name font style", () => {
  test("names the face of every language name in a script the brand face lacks", () => {
    expect(languageNameFontStyle).toEqual({
      "--font-language-name-uk-UA": `${fonts}/Montserrat/language-name-cyrillic.woff2'`,
      "--font-language-name-vi-VN": `${fonts}/Montserrat/language-name-vietnamese.woff2'`,
      "--font-language-name-hi-IN": `${fonts}/Poppins/language-name-devanagari-400.woff2'`,
    });
  });
});
