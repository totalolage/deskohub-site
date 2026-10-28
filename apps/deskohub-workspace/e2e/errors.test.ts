import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  describeBrowserFailure,
  isWorkspaceE2ETimeout,
  withoutWorkspaceE2ETimeout,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";

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

test("reports a timeout as an ordinary failure of the operation", async () => {
  const [timedOut, failed] = await Effect.runPromise(
    Effect.all(
      [
        workspaceE2ETimeoutError("read the viewport timed out", {
          operation: "read the viewport",
        }),
        workspaceE2EError("read the viewport failed", {
          diagnosticCode: "provider_session_row_read_failed_after_redirect",
          operation: "read the viewport",
        }),
      ].map((error) =>
        Effect.flip(
          Effect.fail(error).pipe(
            withoutWorkspaceE2ETimeout("read the viewport")
          )
        )
      )
    )
  );

  expect(isWorkspaceE2ETimeout(timedOut)).toBe(false);
  expect(timedOut?.operation).toBe("read the viewport");
  expect(timedOut?.diagnosticCode).toBeUndefined();
  // Other failures pass through untouched.
  expect(failed?.diagnosticCode).toBe(
    "provider_session_row_read_failed_after_redirect"
  );
});
