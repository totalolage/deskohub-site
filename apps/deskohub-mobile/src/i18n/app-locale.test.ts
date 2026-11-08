import { describe, expect, test } from "bun:test";
import { resolveAppLocale } from "./app-locale";

describe("resolveAppLocale", () => {
  test("returns a supported device locale", () => {
    expect(resolveAppLocale(["cs-CZ"])).toBe("cs-CZ");
    expect(resolveAppLocale(["en-US"])).toBe("en-US");
  });

  test("maps a tag without a region, or with another region, to its language's locale", () => {
    expect(resolveAppLocale(["cs"])).toBe("cs-CZ");
    expect(resolveAppLocale(["en-GB"])).toBe("en-US");
  });

  test("falls back to en-US for unsupported languages", () => {
    expect(resolveAppLocale(["de-DE", "fr"])).toBe("en-US");
  });

  test("falls back to en-US for an empty list", () => {
    expect(resolveAppLocale([])).toBe("en-US");
  });

  test("takes the first supported tag in preference order", () => {
    expect(resolveAppLocale(["de-DE", "cs-CZ", "en-US"])).toBe("cs-CZ");
    expect(resolveAppLocale(["en-GB", "cs-CZ"])).toBe("en-US");
  });
});
