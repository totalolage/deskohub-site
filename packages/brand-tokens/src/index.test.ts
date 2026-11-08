import { describe, expect, test } from "bun:test";
import {
  brandFontFamilies,
  brandFonts,
  brandFontVariation,
  brandRadius,
} from "./index";

test("gives the web radius and its offsets in pixels at a 16px root", () => {
  expect(brandRadius.px.lg).toBeCloseTo(brandRadius.rem * 16);
  expect(brandRadius.px.md).toBeCloseTo(brandRadius.px.lg - 2);
  expect(brandRadius.px.sm).toBeCloseTo(brandRadius.px.lg - 4);
});

describe("brandFontFamilies", () => {
  test("names one family for native text, which takes no fallback list", () => {
    expect(brandFontFamilies.native).toBe(brandFonts.appFamily);
    expect(brandFonts.appFamily).toBe("Sculpin Variable");
  });

  test("puts the brand face first on the web and falls back to the system fonts", () => {
    expect(brandFontFamilies.web).toBe(
      '"Sculpin Variable", "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
    );
    expect(
      brandFontFamilies.web.endsWith(brandFonts.fallback.at(-1) ?? "")
    ).toBe(true);
  });
});

describe("brandFontVariation", () => {
  test("draws the variable face at the given weight in CSS syntax", () => {
    expect(brandFontVariation(400)).toBe("'wght' 400");
    expect(brandFontVariation(brandFonts.weights.heading)).toBe("'wght' 400");
  });
});
