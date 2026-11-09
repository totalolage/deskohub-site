import { describe, expect, test } from "bun:test";
import { stepperModel } from "./stepper-model";

describe("stepperModel", () => {
  test.each([
    ["inside the range", 3, true, true],
    ["at the minimum", 1, false, true],
    ["at the maximum", 5, true, false],
    ["below the minimum", 0, false, true],
    ["above the maximum", 7, true, false],
  ] as const)(
    "steps from a value %s only towards the range",
    (_, value, down, up) => {
      const model = stepperModel({ value, min: 1, max: 5 });

      expect([model.canDecrement, model.canIncrement]).toEqual([down, up]);
    }
  );

  test("can't step either way when the range holds one value", () => {
    const model = stepperModel({ value: 2, min: 2, max: 2 });

    expect([model.canDecrement, model.canIncrement]).toEqual([false, false]);
  });

  test("can't step either way when the maximum is below the minimum", () => {
    for (const value of [0, 1, 2, 3]) {
      const model = stepperModel({ value, min: 2, max: 1 });

      expect([model.canDecrement, model.canIncrement]).toEqual([false, false]);
    }
  });

  test.each([
    [0, 1],
    [1, 1],
    [3, 3],
    [5, 5],
    [9, 5],
  ] as const)("clamps %p into the range as %p", (value, expected) => {
    expect(stepperModel({ value: 3, min: 1, max: 5 }).clamp(value)).toBe(
      expected
    );
  });
});
