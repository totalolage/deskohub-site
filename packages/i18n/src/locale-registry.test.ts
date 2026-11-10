import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  baseLocale,
  getLocaleDefinition,
  isSupportedLocale,
  localeByLanguage,
  mapSupportedLocales,
  matchSupportedLocale,
  supportedLocales,
  unservedLanguageLocale,
  unstatedLanguageLocale,
} from "./locale-registry";

describe("locale registry", () => {
  test("lists the base locale first and every locale once", () => {
    expect(supportedLocales[0]).toBe(baseLocale);
    expect(new Set(supportedLocales).size).toBe(supportedLocales.length);
  });

  test("gives each locale a tag built from its language and region", () => {
    for (const locale of supportedLocales) {
      const definition = getLocaleDefinition(locale);
      expect(definition.tag).toBe(locale);
      expect(`${definition.language}-${definition.region}`).toBe(locale);
    }
  });

  test("serves one locale per language", () => {
    const languages = supportedLocales.map(
      (locale) => getLocaleDefinition(locale).language
    );
    expect(new Set(languages).size).toBe(languages.length);
  });

  test("keeps each fallback chain to other supported locales", () => {
    for (const locale of supportedLocales) {
      const { fallbackChain } = getLocaleDefinition(locale);
      expect(fallbackChain).not.toContain(locale);
      expect(new Set(fallbackChain).size).toBe(fallbackChain.length);
      for (const fallback of fallbackChain) {
        expect(isSupportedLocale(fallback)).toBe(true);
      }
    }
  });

  test("names each locale's Nexi language as an ISO 639-2 code", () => {
    for (const locale of supportedLocales) {
      expect(getLocaleDefinition(locale).nexiLanguage).toMatch(/^[a-z]{3}$/);
    }
  });

  test("names each locale's phone region as an ISO 3166-1 alpha-2 code", () => {
    for (const locale of supportedLocales) {
      expect(getLocaleDefinition(locale).phoneRegion).toMatch(/^[A-Z]{2}$/);
    }
  });

  test("records the visitor defaults as supported locales", () => {
    expect(baseLocale).toBe("en-US");
    expect(unstatedLanguageLocale).toBe("cs-CZ");
    expect(unservedLanguageLocale).toBe("en-US");
  });

  test("records Czech and English", () => {
    expect(getLocaleDefinition("cs-CZ")).toEqual({
      tag: "cs-CZ",
      language: "cs",
      region: "CZ",
      nativeName: "Čeština",
      direction: "ltr",
      script: "latin",
      fallbackChain: ["en-US"],
      nexiLanguage: "cze",
      phoneRegion: "CZ",
    });
    expect(getLocaleDefinition("en-US")).toEqual({
      tag: "en-US",
      language: "en",
      region: "US",
      nativeName: "English",
      direction: "ltr",
      script: "latin",
      fallbackChain: ["cs-CZ"],
      nexiLanguage: "eng",
      phoneRegion: "CZ",
    });
  });

  test("records German, Ukrainian and Slovak", () => {
    expect(getLocaleDefinition("de-DE")).toEqual({
      tag: "de-DE",
      language: "de",
      region: "DE",
      nativeName: "Deutsch",
      direction: "ltr",
      script: "latin",
      fallbackChain: ["en-US", "cs-CZ"],
      nexiLanguage: "deu",
      phoneRegion: "DE",
    });
    // Nexi's hosted page has no Ukrainian, so Ukrainian readers pay in English.
    expect(getLocaleDefinition("uk-UA")).toEqual({
      tag: "uk-UA",
      language: "uk",
      region: "UA",
      nativeName: "Українська",
      direction: "ltr",
      script: "cyrillic",
      fallbackChain: ["en-US", "cs-CZ"],
      nexiLanguage: "eng",
      phoneRegion: "UA",
    });
    expect(getLocaleDefinition("sk-SK")).toEqual({
      tag: "sk-SK",
      language: "sk",
      region: "SK",
      nativeName: "Slovenčina",
      direction: "ltr",
      script: "latin",
      fallbackChain: ["cs-CZ", "en-US"],
      nexiLanguage: "slk",
      phoneRegion: "SK",
    });
  });

  test("records Vietnamese and Hindi", () => {
    // Nexi's hosted page has neither, so their readers pay in English.
    expect(getLocaleDefinition("vi-VN")).toEqual({
      tag: "vi-VN",
      language: "vi",
      region: "VN",
      nativeName: "Tiếng Việt",
      direction: "ltr",
      script: "latin-vietnamese",
      fallbackChain: ["en-US", "cs-CZ"],
      nexiLanguage: "eng",
      phoneRegion: "VN",
    });
    expect(getLocaleDefinition("hi-IN")).toEqual({
      tag: "hi-IN",
      language: "hi",
      region: "IN",
      nativeName: "हिन्दी",
      direction: "ltr",
      script: "devanagari",
      fallbackChain: ["en-US", "cs-CZ"],
      nexiLanguage: "eng",
      phoneRegion: "IN",
    });
  });

  test("lists the served locales in registry order", () => {
    expect([...supportedLocales]).toEqual([
      "en-US",
      "cs-CZ",
      "de-DE",
      "uk-UA",
      "sk-SK",
      "vi-VN",
      "hi-IN",
    ]);
  });
});

describe("isSupportedLocale", () => {
  test("accepts registered tags only, exactly as written", () => {
    expect(isSupportedLocale("cs-CZ")).toBe(true);
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("cs")).toBe(false);
    expect(isSupportedLocale("cs-cz")).toBe(false);
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(isSupportedLocale("constructor")).toBe(false);
  });
});

describe("matchSupportedLocale", () => {
  test("matches a language tag to the locale of its language", () => {
    expect(matchSupportedLocale("cs")).toBe("cs-CZ");
    expect(matchSupportedLocale("CS-cz")).toBe("cs-CZ");
    expect(matchSupportedLocale("en-GB")).toBe("en-US");
    expect(matchSupportedLocale("en_AU")).toBe("en-US");
    expect(matchSupportedLocale(" en ")).toBe("en-US");
    expect(matchSupportedLocale("de-AT")).toBe("de-DE");
    expect(matchSupportedLocale("sk")).toBe("sk-SK");
    expect(matchSupportedLocale("uk")).toBe("uk-UA");
    expect(matchSupportedLocale("vi")).toBe("vi-VN");
    expect(matchSupportedLocale("hi-IN")).toBe("hi-IN");
  });

  test("matches nothing for a language Deskohub doesn't serve", () => {
    expect(matchSupportedLocale("ru-RU")).toBeUndefined();
    expect(matchSupportedLocale("fr")).toBeUndefined();
    expect(matchSupportedLocale("")).toBeUndefined();
    expect(matchSupportedLocale("constructor")).toBeUndefined();
  });

  test("agrees with the language index", () => {
    for (const [language, locale] of Object.entries(localeByLanguage)) {
      expect(matchSupportedLocale(language)).toBe(locale);
    }
  });
});

describe("mapSupportedLocales", () => {
  test("builds one value per supported locale, in registry order", () => {
    const values = mapSupportedLocales((locale) => `value-${locale}`);
    expect(Object.keys(values)).toEqual([...supportedLocales]);
    for (const locale of supportedLocales) {
      expect(values[locale]).toBe(`value-${locale}`);
    }
  });
});

// The mobile app bundles the customer API's locale entry point, which reads
// this registry, so the registry must stay free of runtime dependencies.
test("the registry imports nothing", () => {
  const source = readFileSync(
    new URL("./locale-registry.ts", import.meta.url),
    "utf8"
  );
  expect(new Bun.Transpiler({ loader: "ts" }).scanImports(source)).toEqual([]);
});
