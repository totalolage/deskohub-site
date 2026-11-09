import { describe, expect, test } from "bun:test";
import { nextSlideIndex, previousSlideIndex } from "./gallery-header-slides";

describe("nextSlideIndex", () => {
  test("advances to the following slide", () => {
    expect(nextSlideIndex(0, 3)).toBe(1);
  });

  test("wraps from the last slide to the first", () => {
    expect(nextSlideIndex(2, 3)).toBe(0);
  });
});

describe("previousSlideIndex", () => {
  test("goes back to the preceding slide", () => {
    expect(previousSlideIndex(2, 3)).toBe(1);
  });

  test("wraps from the first slide to the last", () => {
    expect(previousSlideIndex(0, 3)).toBe(2);
  });
});
