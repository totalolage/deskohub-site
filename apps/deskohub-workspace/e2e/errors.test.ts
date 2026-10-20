import { expect, test } from "bun:test";
import { describeBrowserFailure } from "./errors";

test("describes a browser failure by its first line without its URLs", () => {
  expect(
    describeBrowserFailure(
      new Error(
        "page.waitForFunction: Target page, context or browser has been closed at https://preview.example.test/en-US/account?token=secret\nCall log:\n  - waiting"
      )
    )
  ).toBe(
    "Error: page.waitForFunction: Target page, context or browser has been closed at [url]"
  );
  expect(describeBrowserFailure(new TypeError("x".repeat(40)))).toBe(
    "TypeError: [token]"
  );
  expect(describeBrowserFailure("a thrown string")).toBe(
    "failure: a thrown string"
  );
});
