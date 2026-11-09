import { describe, expect, test } from "bun:test";
import { choiceIndexForKey, tabStopIndex } from "./choice-group-keys";

describe("choiceIndexForKey", () => {
  test("arrows step through the options and wrap at either end", () => {
    for (const key of ["ArrowDown", "ArrowRight"]) {
      expect(choiceIndexForKey(key, 0, 3)).toBe(1);
      expect(choiceIndexForKey(key, 2, 3)).toBe(0);
    }
    for (const key of ["ArrowUp", "ArrowLeft"]) {
      expect(choiceIndexForKey(key, 2, 3)).toBe(1);
      expect(choiceIndexForKey(key, 0, 3)).toBe(2);
    }
  });

  test("Home and End jump to the first and last option", () => {
    expect(choiceIndexForKey("Home", 2, 3)).toBe(0);
    expect(choiceIndexForKey("End", 0, 3)).toBe(2);
  });

  test("Space chooses the focused option", () => {
    expect(choiceIndexForKey(" ", 1, 3)).toBe(1);
  });

  test("other keys are left to the platform", () => {
    for (const key of ["Enter", "Tab", "a", "constructor"]) {
      expect(choiceIndexForKey(key, 1, 3)).toBeUndefined();
    }
  });
});

describe("tabStopIndex", () => {
  test("the chosen option holds the tab stop, else the first", () => {
    expect(tabStopIndex(["a", "b", "c"], "b")).toBe(1);
    expect(tabStopIndex(["a", "b", "c"], "z")).toBe(0);
  });
});
