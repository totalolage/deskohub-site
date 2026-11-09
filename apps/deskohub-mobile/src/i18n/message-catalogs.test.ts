import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};

const readCatalog = (locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      new URL(`../../messages/${locale}.json`, import.meta.url),
      "utf8"
    )
  );

const placeholdersOf = (message: string): ReadonlyArray<string> =>
  Array.from(
    message.matchAll(/\{([^{}]+)\}/g),
    ([, name]) => name ?? ""
  ).sort();

const baseCatalog = readCatalog(inlangSettings.baseLocale);

// Every catalog carries the base catalog's messages in its order, so a
// translator's file reads side by side with the base, and each message keeps
// the base's placeholders, so the same call fills every locale.
describe.each(
  inlangSettings.locales.filter(
    (locale) => locale !== inlangSettings.baseLocale
  )
)("the %s message catalog", (locale) => {
  test("has the base catalog's keys in the same order", () => {
    expect(Object.keys(readCatalog(locale))).toEqual(Object.keys(baseCatalog));
  });

  test("keeps each message's placeholders", () => {
    const catalog = readCatalog(locale);
    for (const [key, baseMessage] of Object.entries(baseCatalog)) {
      const message = catalog[key];
      if (typeof message !== "string" || typeof baseMessage !== "string") {
        continue;
      }
      expect({ key, placeholders: placeholdersOf(message) }).toEqual({
        key,
        placeholders: placeholdersOf(baseMessage),
      });
    }
  });
});

describe.each(inlangSettings.locales)("the %s message catalog", (locale) => {
  test("has a non-empty text for every message", () => {
    const blank = Object.entries(readCatalog(locale))
      .filter(
        ([, message]) => typeof message !== "string" || message.trim() === ""
      )
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });
});
