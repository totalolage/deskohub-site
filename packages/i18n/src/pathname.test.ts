import { describe, expect, test } from "bun:test";
import {
  getLocaleFromPathname,
  getLocalizedPathVariants,
  parseLocalizedPathname,
  pathnameHasLocale,
  prefixPathnameWithLocale,
  replaceLocaleInPathname,
  stripLocaleFromPathname,
} from "./pathname";

const locales = ["en", "fr", "zh-Hant-HK"] as const;

describe("locale detection", () => {
  test("finds locale at pathname boundary", () => {
    expect(getLocaleFromPathname("/fr/about", locales)).toBe("fr");
    expect(getLocaleFromPathname("zh-Hant-HK/products", locales)).toBe(
      "zh-Hant-HK"
    );
    expect(getLocaleFromPathname("/france", locales)).toBeUndefined();
  });

  test("parses localized and unlocalized pathnames", () => {
    expect(parseLocalizedPathname("/en", locales)).toEqual({
      locale: "en",
      pathname: "/",
    });
    expect(parseLocalizedPathname("/zh-Hant-HK/shop", locales)).toEqual({
      locale: "zh-Hant-HK",
      pathname: "/shop",
    });
    expect(parseLocalizedPathname("/shop", locales)).toEqual({
      locale: undefined,
      pathname: "/shop",
    });
  });
});

describe("strip and locale checks", () => {
  test("strips locale prefix and reports locale presence", () => {
    expect(stripLocaleFromPathname("/fr/products", locales)).toBe("/products");
    expect(stripLocaleFromPathname("/fr/", locales)).toBe("/");

    expect(pathnameHasLocale("/zh-Hant-HK/products", locales)).toBeTrue();
    expect(pathnameHasLocale("/zh-Hant/products", locales)).toBeFalse();
  });
});

describe("replace, prefix, and variants", () => {
  test("replaces locale and handles root path", () => {
    expect(replaceLocaleInPathname("/fr/products", "en", locales)).toBe(
      "/en/products"
    );
    expect(replaceLocaleInPathname("/zh-Hant-HK", "fr", locales)).toBe("/fr");
    expect(replaceLocaleInPathname("/", "fr", locales)).toBe("/fr");
  });

  test("prefixes locale for rooted and unrooted pathnames", () => {
    expect(prefixPathnameWithLocale("/", "en")).toBe("/en");
    expect(prefixPathnameWithLocale("/products", "en")).toBe("/en/products");
    expect(prefixPathnameWithLocale("products", "en")).toBe("/en/products");
  });

  test("builds localized path variants for every locale", () => {
    const variants = getLocalizedPathVariants("/fr/products/item", locales);

    expect(Object.fromEntries(variants)).toEqual({
      en: "/en/products/item",
      fr: "/fr/products/item",
      "zh-Hant-HK": "/zh-Hant-HK/products/item",
    });
  });
});
