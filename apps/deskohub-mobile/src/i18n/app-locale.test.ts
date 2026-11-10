import { describe, expect, test } from "bun:test";
import { resolveAppLocale } from "./app-locale";

describe("resolveAppLocale", () => {
  test("returns a supported device locale", () => {
    expect(resolveAppLocale(["cs-CZ"])).toBe("cs-CZ");
    expect(resolveAppLocale(["en-US"])).toBe("en-US");
    expect(resolveAppLocale(["uk-UA"])).toBe("uk-UA");
  });

  test("maps a tag without a region, or with another region, to its language's locale", () => {
    expect(resolveAppLocale(["cs"])).toBe("cs-CZ");
    expect(resolveAppLocale(["en-GB"])).toBe("en-US");
    expect(resolveAppLocale(["de-AT"])).toBe("de-DE");
    expect(resolveAppLocale(["sk"])).toBe("sk-SK");
    expect(resolveAppLocale(["uk"])).toBe("uk-UA");
  });

  test("falls back to en-US for unsupported languages", () => {
    expect(resolveAppLocale(["fr-FR", "pl"])).toBe("en-US");
  });

  test("falls back to en-US for an empty list", () => {
    expect(resolveAppLocale([])).toBe("en-US");
  });

  test("takes the first supported tag in preference order", () => {
    expect(resolveAppLocale(["fr-FR", "cs-CZ", "en-US"])).toBe("cs-CZ");
    expect(resolveAppLocale(["de-CH", "cs-CZ"])).toBe("de-DE");
    expect(resolveAppLocale(["en-GB", "cs-CZ"])).toBe("en-US");
  });
});
