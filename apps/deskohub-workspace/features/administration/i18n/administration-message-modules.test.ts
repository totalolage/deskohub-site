import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { m } from ".";
import { baseLocale, locales } from "./paraglide/runtime.js";

const messagesDirectory = join(import.meta.dir, "paraglide", "messages");

// A locale whose catalog is missing, or lacks a message, compiles to the base
// locale's text for that message.
const readCatalog = (locale: string): Partial<Record<string, string>> => {
  const catalogPath = join(
    import.meta.dir,
    "messages",
    "shell",
    `${locale}.json`
  );
  return existsSync(catalogPath)
    ? JSON.parse(readFileSync(catalogPath, "utf8"))
    : {};
};

describe("administration message modules", () => {
  // One module per message cost about 1,800 modules in every cold Turbopack
  // compile; locale modules keep the catalog at one module per locale.
  test("compiles the catalog into one module per locale", () => {
    expect(readdirSync(messagesDirectory).toSorted()).toEqual(
      ["_index.js", ...locales.map((locale) => `${locale}.js`)].toSorted()
    );
  });

  test("renders each locale's catalog text, else the base locale's", () => {
    const baseText = readCatalog(baseLocale).shellSkipToMainContent;
    expect(baseText).toBeString();
    for (const locale of locales) {
      expect(m.shellSkipToMainContent({}, { locale })).toBe(
        readCatalog(locale).shellSkipToMainContent ?? baseText
      );
    }
  });
});
