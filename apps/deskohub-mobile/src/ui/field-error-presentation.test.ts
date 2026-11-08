import { describe, expect, test } from "bun:test";
import { fieldErrorPresentation } from "./field-error-presentation";
import { idleLiveRegionLayout } from "./notice-presentation";

describe("fieldErrorPresentation", () => {
  test("a missing or empty error leaves the field valid and the region idle", () => {
    for (const error of [undefined, ""]) {
      expect(fieldErrorPresentation(error)).toMatchObject({
        invalid: false,
        description: undefined,
        idleLayout: idleLiveRegionLayout,
      });
    }
  });

  test("an error marks the field invalid and describes it", () => {
    const error = "x";
    expect(fieldErrorPresentation(error)).toMatchObject({
      invalid: true,
      description: error,
      idleLayout: undefined,
    });
  });

  test("the region announces politely whether or not there is an error", () => {
    for (const error of [undefined, "x"]) {
      expect(fieldErrorPresentation(error)).toMatchObject({
        role: "status",
        live: "polite",
      });
    }
  });
});
