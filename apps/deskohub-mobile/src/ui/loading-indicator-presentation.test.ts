import { describe, expect, test } from "bun:test";
import { loadingDieBox } from "@deskohub/brand-motion/loading-die";
import { brandColors } from "@deskohub/brand-tokens";
import { theme } from "../theme";
import {
  loadingIndicatorFill,
  loadingIndicatorLayout,
  loadingIndicatorSemantics,
} from "./loading-indicator-presentation";

describe("loadingIndicatorLayout", () => {
  test.each([
    ["inline", "inPlace", 20],
    ["section", "tumble", 32],
    ["screen", "tumble", 64],
  ] as const)(
    "draws %s as %s with the die %d dp tall at rest",
    (size, motion, dieHeight) => {
      const layout = loadingIndicatorLayout(size);
      const box = loadingDieBox(motion);
      expect(layout.motion).toBe(motion);
      // The whole frame scales with the die, so the hop keeps its room.
      expect(layout.height * (box.dieHeight / box.height)).toBeCloseTo(
        dieHeight,
        6
      );
      expect(layout.width / layout.height).toBeCloseTo(
        box.width / box.height,
        6
      );
    }
  );
});

describe("loadingIndicatorFill", () => {
  test("gives the brand tone the logo's gradient", () => {
    expect(loadingIndicatorFill("brand")).toEqual({ kind: "brand" });
  });

  test.each([
    ["white", theme.colors.text],
    ["navy", brandColors.navyBlue],
  ] as const)("fills the %s tone with its theme colour", (tone, color) => {
    expect(loadingIndicatorFill(tone)).toEqual({ kind: "solid", color });
  });

  test("fills an explicit colour as given", () => {
    expect(loadingIndicatorFill({ color: "#123456" })).toEqual({
      kind: "solid",
      color: "#123456",
    });
  });
});

describe("loadingIndicatorSemantics", () => {
  test("names a labelled indicator as a busy progress bar", () => {
    expect(loadingIndicatorSemantics("label")).toEqual({
      accessible: true,
      role: "progressbar",
      "aria-label": "label",
      "aria-busy": true,
    });
  });

  test("hides an unlabelled indicator and its contents from assistive tech", () => {
    expect(loadingIndicatorSemantics(undefined)).toEqual({
      "aria-hidden": true,
      importantForAccessibility: "no-hide-descendants",
    });
  });
});
