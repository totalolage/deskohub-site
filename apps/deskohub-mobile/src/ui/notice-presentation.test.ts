import { describe, expect, test } from "bun:test";
import {
  idleLiveRegionLayout,
  noticePresentation,
} from "./notice-presentation";

describe("noticePresentation", () => {
  test("a missing or empty message keeps the live region but shows nothing", () => {
    for (const message of [undefined, ""]) {
      expect(noticePresentation("info", message)).toMatchObject({
        shown: false,
        role: "status",
        live: "polite",
      });
      expect(noticePresentation("error", message)).toMatchObject({
        shown: false,
        role: "alert",
        live: "assertive",
      });
    }
  });

  test("errors interrupt, info and warnings wait their turn", () => {
    expect(noticePresentation("error", "x")).toMatchObject({
      shown: true,
      role: "alert",
      live: "assertive",
    });
    for (const tone of ["info", "warning"] as const) {
      expect(noticePresentation(tone, "x")).toMatchObject({
        shown: true,
        role: "status",
        live: "polite",
      });
    }
  });
});

test("an idle live region sits out of the layout flow", () => {
  // In flow, its empty line plus the parent's gap left blank space.
  expect(idleLiveRegionLayout.position).toBe("absolute");
  expect(idleLiveRegionLayout.overflow).toBe("hidden");
  expect(idleLiveRegionLayout.width).toBeLessThanOrEqual(1);
  expect(idleLiveRegionLayout.height).toBeLessThanOrEqual(1);
});
