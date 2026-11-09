import { describe, expect, test } from "bun:test";
import {
  getLocalizedCountryName,
  getTranslatedCityName,
} from "./geo-formatting";

describe("getLocalizedCountryName", () => {
  test("names a region in the given locale", () => {
    expect(getLocalizedCountryName("CZ", "en-US")).toBe(
      new Intl.DisplayNames(["en-US"], { type: "region" }).of("CZ") ?? ""
    );
    expect(getLocalizedCountryName("CZ", "cs-CZ")).toBe(
      new Intl.DisplayNames(["cs-CZ"], { type: "region" }).of("CZ") ?? ""
    );
  });

  test("returns the code when the locale or code is invalid", () => {
    expect(getLocalizedCountryName("CZ", "not a locale")).toBe("CZ");
    expect(getLocalizedCountryName("not-a-code", "en-US")).toBe("not-a-code");
  });
});

describe("getTranslatedCityName", () => {
  test("translates a known city into a supported locale", () => {
    expect(getTranslatedCityName("Prague", "cs-CZ")).toBe("Praha");
    expect(getTranslatedCityName("Prague", "en-US")).toBe("Prague");
  });

  test("keeps the key for an unknown city or locale", () => {
    expect(getTranslatedCityName("Brno", "cs-CZ")).toBe("Brno");
    expect(getTranslatedCityName("Prague", "de-DE")).toBe("Prague");
  });
});
