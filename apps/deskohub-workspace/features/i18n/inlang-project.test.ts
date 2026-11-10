import { expect, test } from "bun:test";
import { baseLocale, supportedLocales } from "@deskohub/i18n/locale-registry";
import inlangSettings from "@/project.inlang/settings.json" with {
  type: "json",
};

// Paraglide compiles the customer catalog, and the database CHECKs and URL
// patterns read the same settings, from this project; it must serve exactly
// the locale registry's locales.
test("the customer Inlang project serves the locale registry's locales", () => {
  expect(inlangSettings.locales).toEqual([...supportedLocales]);
  expect(inlangSettings.baseLocale).toBe(baseLocale);
});
