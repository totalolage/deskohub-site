import { describe, expect, test } from "bun:test";
import {
  getClosestVirtualIndex,
  getSwipeTargetVirtualIndex,
  truncateTowardZero,
  wrapIndex,
} from "./use-motion-swipe-carousel";

describe("carousel index helpers", () => {
  test("wraps indexes without modulo-zero surprises", () => {
    expect(wrapIndex(6, 5)).toBe(1);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(3, 0)).toBe(0);
  });

  test("moves to the closest virtual index", () => {
    expect(getClosestVirtualIndex(0, 4, 5)).toBe(5);
    expect(getClosestVirtualIndex(4, 0, 5)).toBe(-1);
    expect(getClosestVirtualIndex(2, 7, 0)).toBe(7);
  });

  test("truncates toward zero", () => {
    expect(truncateTowardZero(1.8)).toBe(1);
    expect(truncateTowardZero(-1.8)).toBe(-1);
  });
});

describe("getSwipeTargetVirtualIndex", () => {
  const getTarget = (
    overrides: Partial<Parameters<typeof getSwipeTargetVirtualIndex>[0]>
  ) =>
    getSwipeTargetVirtualIndex({
      currentVirtualIndex: 10,
      offsetX: 0,
      offsetY: 0,
      swipeDistance: 100,
      velocityX: 0,
      ...overrides,
    });

  test("ignores vertical, tiny, and impossible swipes", () => {
    expect(getTarget({ offsetX: -100, offsetY: 120 })).toBe(10);
    expect(getTarget({ offsetX: -20 })).toBe(10);
    expect(getTarget({ offsetX: -100, swipeDistance: 0 })).toBe(10);
  });

  test("commits by threshold or velocity", () => {
    expect(getTarget({ offsetX: -33 })).toBe(11);
    expect(getTarget({ offsetX: 33 })).toBe(9);
    expect(getTarget({ offsetX: -12, velocityX: -600 })).toBe(11);
    expect(getTarget({ offsetX: 12, velocityX: 600 })).toBe(9);
  });

  test("keeps whole-slide drag distance", () => {
    expect(getTarget({ offsetX: -220 })).toBe(12);
    expect(getTarget({ offsetX: 220 })).toBe(8);
  });
});
