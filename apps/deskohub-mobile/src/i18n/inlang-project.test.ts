import { expect, test } from "bun:test";
import { baseLocale, supportedLocales } from "@deskohub/i18n/locale-registry";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};

// Paraglide compiles the app's catalogs from this project, and the app passes
// its locales where the locale registry's are expected; it must serve exactly
// the registry's locales.
test("the app's Inlang project serves the locale registry's locales", () => {
  expect(inlangSettings.locales).toEqual([...supportedLocales]);
  expect(inlangSettings.baseLocale).toBe(baseLocale);
});
