import { describe, expect, test } from "bun:test";
import {
  normalizeLocaleTag,
  parseAcceptLanguage,
  resolvePreferredLocale,
} from "./core";

describe("normalizeLocaleTag", () => {
  test("normalizes language, script, and region subtags", () => {
    expect(normalizeLocaleTag("zh-hant-hk")).toBe("zh-Hant-HK");
    expect(normalizeLocaleTag("SR-cYRL-rs")).toBe("sr-Cyrl-RS");
    expect(normalizeLocaleTag("en-us")).toBe("en-US");
    expect(normalizeLocaleTag("es-419")).toBe("es-419");
  });
});

describe("parseAcceptLanguage", () => {
  test("sorts by q-value and ignores wildcard and invalid quality entries", () => {
    const parsed = parseAcceptLanguage(
      "fr-CA;q=0.7, en-US;q=0.9, zh-hant-hk;q=1, *;q=0.5, de;q=0, en;q=abc"
    );

    expect(parsed).toEqual([
      {
        localeToken: "zh-hant-hk",
        normalizedLocaleToken: "zh-Hant-HK",
        baseLanguage: "zh",
        quality: 1,
        order: 2,
      },
      {
        localeToken: "en-US",
        normalizedLocaleToken: "en-US",
        baseLanguage: "en",
        quality: 0.9,
        order: 1,
      },
      {
        localeToken: "fr-CA",
        normalizedLocaleToken: "fr-CA",
        baseLanguage: "fr",
        quality: 0.7,
        order: 0,
      },
    ]);
  });

  test("keeps original order when q-values are equal", () => {
    const parsed = parseAcceptLanguage("fr;q=0.8,en;q=0.8");

    expect(parsed.map((entry) => entry.normalizedLocaleToken)).toEqual([
      "fr",
      "en",
    ]);
  });
});

describe("resolvePreferredLocale", () => {
  const locales = ["en", "en-US", "fr", "zh-Hant-HK"] as const;

  test("matches direct normalized locale tokens first", () => {
    const preferred = resolvePreferredLocale({
      headerValue: "zh-hant-hk, en;q=0.8",
      locales,
    });

    expect(preferred).toBe("zh-Hant-HK");
  });

  test("falls back to preferred language mapping using q-values", () => {
    const preferred = resolvePreferredLocale({
      headerValue: "de-DE;q=1, fr-CA;q=0.9, en-GB;q=0.95",
      locales,
      preferredLanguageToLocale: {
        en: "en-US",
        fr: "fr",
      },
    });

    expect(preferred).toBe("en-US");
  });

  test("returns undefined when no locale can be resolved", () => {
    const preferred = resolvePreferredLocale({
      headerValue: "de-DE, it-IT;q=0.8",
      locales,
    });

    expect(preferred).toBeUndefined();
  });
});
