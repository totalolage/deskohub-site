import { describe, expect, mock, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { nextFontLocal } from "@/shared/testing/next-font-local.test-utils";

mock.module("next/font/local", () => nextFontLocal);

const { getLocaleTypographyStyle } = await import("./locale-fonts");

const brandFamilies = "'sculpin', 'sculpin Fallback'";
const fonts = "'../../assets/fonts";

describe("locale typography style", () => {
  test("leaves Latin-script pages on the brand families alone", () => {
    const latinLocales = supportedLocales.filter(
      (locale) => getLocaleDefinition(locale).script === "latin"
    );

    expect(latinLocales).toContain("cs-CZ");
    for (const locale of latinLocales) {
      expect(getLocaleTypographyStyle(locale, brandFamilies)).toBeUndefined();
    }
  });

  test("puts Montserrat's Cyrillic between Sculpin and its fallback on Ukrainian pages", () => {
    expect(getLocaleTypographyStyle("uk-UA", brandFamilies)).toEqual({
      "--font-text": `'sculpin', ${fonts}/Montserrat/cyrillic.woff2', 'sculpin Fallback'`,
    });
  });

  test("sets Vietnamese pages in Montserrat ahead of Sculpin", () => {
    expect(getLocaleTypographyStyle("vi-VN", brandFamilies)).toEqual({
      "--font-text": `${fonts}/Montserrat/vietnamese.woff2', ${fonts}/Montserrat/latin-ext.woff2', 'sculpin', 'sculpin Fallback'`,
    });
  });

  test("puts Poppins' Devanagari and the system Devanagari fonts after Sculpin on Hindi pages, in taller lines", () => {
    const style = getLocaleTypographyStyle("hi-IN", brandFamilies) as Record<
      string,
      string
    >;

    expect(style["--font-text"]).toBe(
      `'sculpin', ${fonts}/Poppins/devanagari-400.woff2', "Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari", 'sculpin Fallback'`
    );
    for (const [property, value] of Object.entries(style)) {
      if (property === "--font-text") continue;
      expect(Number(value)).toBeGreaterThanOrEqual(1.6);
      expect(Number(value)).toBeLessThanOrEqual(1.75);
    }
    expect(style.lineHeight).toBeDefined();
  });
});
