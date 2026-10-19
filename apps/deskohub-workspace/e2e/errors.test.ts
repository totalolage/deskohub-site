import { expect, test } from "bun:test";
import { describeBrowserFailure } from "./errors";

test("names known browser failures with fixed text that drops the message", () => {
  const url = "https://preview.example.test/en-US/account?token=secret";
  expect(
    describeBrowserFailure(
      new Error(
        `page.waitForFunction: Target page, context or browser has been closed at ${url}`
      )
    )
  ).toBe("the page or browser closed");
  expect(
    describeBrowserFailure(
      new Error(
        `page.waitForFunction: Execution context was destroyed, most likely because of a navigation to ${url}`
      )
    )
  ).toBe("the page navigated during the call");
  expect(describeBrowserFailure(new TypeError(url))).toBe(
    "an unrecognized TypeError"
  );
  expect(describeBrowserFailure(url)).toBe("an unrecognized failure");
});
