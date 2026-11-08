import { describe, expect, test } from "bun:test";
import {
  getAllLocalizedPaths,
  getLocaleFromPathname,
  getLocalizedHref,
  pathnameHasLocale,
  removeLocaleFromPathname,
  setLocaleInPathname,
} from "./locale-url";

describe("getLocalizedHref", () => {
  test.each([
    ["https://example.test/menu"],
    ["mailto:bar@example.test"],
    ["#reservation"],
    ["menu"],
    ["//cdn.example.test/menu"],
  ])("leaves %s unchanged because it is not a site path", (href) => {
    expect(getLocalizedHref(href, "en-US")).toBe(href);
  });

  test("prefixes a bare site path with the locale", () => {
    expect(getLocalizedHref("/menu", "en-US")).toBe("/en-US/menu");
    expect(getLocalizedHref("/", "en-US")).toBe("/en-US");
  });

  test("replaces the locale already in the path", () => {
    expect(getLocalizedHref("/cs-CZ/menu", "en-US")).toBe("/en-US/menu");
  });

  test("keeps the query and fragment after the localized path", () => {
    expect(getLocalizedHref("/menu?table=4#drinks", "cs-CZ")).toBe(
      "/cs-CZ/menu?table=4#drinks"
    );
    expect(getLocalizedHref("/en-US/menu#drinks", "cs-CZ")).toBe(
      "/cs-CZ/menu#drinks"
    );
  });
});

describe("locale pathname helpers", () => {
  test("read, set, and remove the Bar's locales", () => {
    expect(getLocaleFromPathname("/en-US/menu")).toBe("en-US");
    expect(getLocaleFromPathname("/de-DE/menu")).toBeUndefined();
    expect(pathnameHasLocale("/cs-CZ")).toBe(true);
    expect(pathnameHasLocale("/menu")).toBe(false);
    expect(setLocaleInPathname("/menu", "cs-CZ")).toBe("/cs-CZ/menu");
    expect(removeLocaleFromPathname("/en-US/menu")).toBe("/menu");
  });

  test("lists the path in every Bar locale", () => {
    expect(Object.fromEntries(getAllLocalizedPaths("/en-US/menu"))).toEqual({
      "cs-CZ": "/cs-CZ/menu",
      "en-US": "/en-US/menu",
    });
  });
});
