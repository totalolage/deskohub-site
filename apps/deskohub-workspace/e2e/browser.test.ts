import { expect, test } from "bun:test";
import { errors as playwrightErrors } from "@playwright/test";
import { Cause, Effect, Exit } from "effect";
import {
  findEnabledSnapshotRef,
  getSnapshotRef,
  isFrameSnapshotRef,
  waitForBrowserCondition,
} from "./browser";
import { isWorkspaceE2ETimeout } from "./errors";
import { pollUntil } from "./polling";
import type { Runner } from "./runtime";

// The runner wraps a failed command like the Playwright runtime does.
const failingWaitRunner = (failures: readonly Error[]) => {
  let calls = 0;
  const run: Runner = async (command, args) => {
    const failure = failures[calls];
    calls += 1;
    if (failure)
      throw new Error(`${command} ${args.join(" ")} failed`, {
        cause: failure,
      });
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  return { calls: () => calls, run };
};

const pollBrowserCondition = (run: Runner) =>
  pollUntil(
    waitForBrowserCondition(run, "browser-test", "sale", "true", {
      timeoutMs: 5,
    }).pipe(
      Effect.as(true),
      Effect.catchIf(isWorkspaceE2ETimeout, () => Effect.succeed(undefined))
    ),
    { intervalMs: 1, label: "sale", timeoutMs: 5000 }
  );

test("retries a browser condition that hit its Playwright timeout", async () => {
  const runner = failingWaitRunner([
    new playwrightErrors.TimeoutError("Timeout 5ms exceeded."),
  ]);

  expect(await Effect.runPromise(pollBrowserCondition(runner.run))).toBe(true);
  expect(runner.calls()).toBe(2);
});

test("keeps a non-timeout browser condition failure terminal", async () => {
  const runner = failingWaitRunner([new Error("Target page closed")]);

  const exit = await Effect.runPromiseExit(pollBrowserCondition(runner.run));

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  expect(isWorkspaceE2ETimeout(Cause.squash(exit.cause))).toBe(false);
  expect(runner.calls()).toBe(1);
});

test("ignores disabled snapshot targets with additional state attributes", () => {
  const snapshot = [
    '- textbox "Card number" [disabled, ref=e1]',
    '- textbox "Card number" [ref=e2]',
  ].join("\n");

  expect(findEnabledSnapshotRef(snapshot, ["Card number"])).toBe("@e2");
});

test("accepts Playwright AI snapshot references from the main page and frames", () => {
  expect(getSnapshotRef('- button "Save" [ref=e2]')).toBe("@e2");
  expect(getSnapshotRef('- textbox "Card number" [ref=f1e4]')).toBe("@f1e4");
  expect(isFrameSnapshotRef("@e2")).toBe(false);
  expect(isFrameSnapshotRef("@f1e4")).toBe(true);
});
