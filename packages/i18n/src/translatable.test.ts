import { describe, expect, test } from "bun:test";
import { getTranslatedValue } from "./translatable";

describe("getTranslatedValue", () => {
  test("returns the default for a missing or empty value", () => {
    expect(getTranslatedValue(null, "cs", "fallback")).toBe("fallback");
    expect(getTranslatedValue(undefined, "cs", "fallback")).toBe("fallback");
    expect(getTranslatedValue("", "cs", "fallback")).toBe("fallback");
    expect(getTranslatedValue(null, "cs")).toBeUndefined();
  });

  test("returns a plain string unchanged for every locale", () => {
    expect(getTranslatedValue("Desk", "cs", "fallback")).toBe("Desk");
    expect(getTranslatedValue("Desk", "en-US", "fallback")).toBe("Desk");
  });

  test("prefers the exact locale translation", () => {
    expect(
      getTranslatedValue({ "en-US": "US", en: "EN" }, "en-US", "fallback")
    ).toBe("US");
  });

  test("falls back to the base language of a regional locale", () => {
    expect(getTranslatedValue({ en: "EN" }, "en-US", "fallback")).toBe("EN");
    expect(getTranslatedValue({ "en-US": "", en: "EN" }, "en-US")).toBe("EN");
  });

  test("returns the default when neither the locale nor its language has a translation", () => {
    expect(getTranslatedValue({ cs: "CS" }, "en-US", "fallback")).toBe(
      "fallback"
    );
    expect(getTranslatedValue({ en: "" }, "en", null)).toBeNull();
  });

  test("returns the default for an empty locale with no base language", () => {
    expect(getTranslatedValue({ en: "EN" }, "", "fallback")).toBe("fallback");
  });
});
