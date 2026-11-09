import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { locales, m } from ".";

const messagesDirectory = join(import.meta.dir, "paraglide", "messages");

const readCatalog = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "messages", `${locale}.json`), "utf8")
  );

describe("customer message modules", () => {
  // One module per message cost about 1,000 modules in every cold Turbopack
  // compile; locale modules keep the catalog at one module per locale.
  test("compiles the catalog into one module per locale", () => {
    expect(readdirSync(messagesDirectory).toSorted()).toEqual(
      ["_index.js", ...locales.map((locale) => `${locale}.js`)].toSorted()
    );
  });

  test("renders each locale's catalog text", () => {
    for (const locale of locales) {
      expect(m.accountHelpTitle({}, { locale })).toBe(
        readCatalog(locale).accountHelpTitle
      );
    }
  });
});
