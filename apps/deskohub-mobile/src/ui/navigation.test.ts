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
    expect(stackScreenOptions("cs-CZ").headerTitleStyle).toEqual({
      color: theme.colors.text,
      fontFamily: brandFontFamilies.native,
      fontSize: theme.type.bodyStrong.fontSize,
      fontWeight: brandFonts.weights.emphasis,
      fontVariationSettings: brandFontVariation(brandFonts.weights.emphasis),
    });
  });

  test("titles in another script render in the system font", () => {
    expect(stackScreenOptions("uk-UA").headerTitleStyle).toEqual({
      color: theme.colors.text,
      fontSize: theme.type.bodyStrong.fontSize,
      fontWeight: brandFonts.weights.emphasis,
    });
  });
});

describe("tab bar", () => {
  test("labels render in the brand face", () => {
    expect(tabScreenOptions("en-US").tabBarLabelStyle).toHaveProperty(
      "fontFamily",
      brandFontFamilies.native
    );
  });

  test("labels in another script render in the system font", () => {
    expect(tabScreenOptions("uk-UA").tabBarLabelStyle).not.toHaveProperty(
      "fontFamily"
    );
  });
});
