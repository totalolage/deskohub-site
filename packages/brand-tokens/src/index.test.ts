import { expect, test } from "bun:test";
import { brandRadius } from "./index";

test("gives the web radius and its offsets in pixels at a 16px root", () => {
  expect(brandRadius.px.lg).toBeCloseTo(brandRadius.rem * 16);
  expect(brandRadius.px.md).toBeCloseTo(brandRadius.px.lg - 2);
  expect(brandRadius.px.sm).toBeCloseTo(brandRadius.px.lg - 4);
});
