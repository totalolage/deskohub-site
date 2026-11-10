import { describe, expect, mock, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { nextFontLocal } from "@/shared/testing/next-font-local.test-utils";

mock.module("next/font/local", () => nextFontLocal);

const { getLocaleBrandFontStack } = await import("./locale-fonts");

const brandFamilies = "'sculpin', 'sculpin Fallback'";

describe("locale brand font stack", () => {
  test("leaves Latin-script pages on the brand families alone", () => {
    const latinLocales = supportedLocales.filter(
      (locale) => getLocaleDefinition(locale).script === "latin"
    );

    expect(latinLocales).toContain("cs-CZ");
    for (const locale of latinLocales) {
      expect(getLocaleBrandFontStack(locale, brandFamilies)).toBeUndefined();
    }
  });

  test("puts Montserrat's Cyrillic between Sculpin and its fallback on Ukrainian pages", () => {
    expect(getLocaleBrandFontStack("uk-UA", brandFamilies)).toBe(
      "'sculpin', '../../assets/fonts/Montserrat/cyrillic.woff2', 'sculpin Fallback'"
    );
  });
});
