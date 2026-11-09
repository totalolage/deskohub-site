import { describe, expect, test } from "bun:test";
import {
  brandFontFamilies,
  brandFonts,
  brandFontVariation,
} from "@deskohub/brand-tokens";
import { theme } from "../theme";
import { stackScreenOptions, tabScreenOptions } from "./navigation";

describe("stack headers", () => {
  test("titles render in the brand face at its emphasis weight", () => {
    expect(stackScreenOptions.headerTitleStyle).toEqual({
      color: theme.colors.text,
      fontFamily: brandFontFamilies.native,
      fontSize: theme.type.bodyStrong.fontSize,
      fontWeight: brandFonts.weights.emphasis,
      fontVariationSettings: brandFontVariation(brandFonts.weights.emphasis),
    });
  });
});

describe("tab bar", () => {
  test("labels render in the brand face", () => {
    expect(tabScreenOptions.tabBarLabelStyle.fontFamily).toBe(
      brandFontFamilies.native
    );
  });
});
