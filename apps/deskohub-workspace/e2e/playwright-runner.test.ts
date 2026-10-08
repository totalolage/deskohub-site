import { expect, test } from "bun:test";
import { runWorkspacePlaywrightWithFailureCleanup } from "./playwright-runner";

test("runs the cleanup-only project after a failed suite and preserves its exit", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return invocation === "suite" ? 1 : 0;
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 0 });
});

test("does not rerun cleanup after a successful suite", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 0;
    }
  );

  expect(invocations).toEqual(["suite"]);
  expect(result).toEqual({ suiteExitCode: 0 });
});

test("reports a failed cleanup-only project without losing the suite failure", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      return 1;
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({ suiteExitCode: 1, cleanupExitCode: 1 });
});

test("keeps the suite failure when the cleanup process cannot start", async () => {
  const invocations: string[] = [];
  const result = await runWorkspacePlaywrightWithFailureCleanup(
    async (invocation) => {
      invocations.push(invocation);
      if (invocation === "suite") return 1;
      throw new Error("private process error");
    }
  );

  expect(invocations).toEqual(["suite", "failure-cleanup"]);
  expect(result).toEqual({
    suiteExitCode: 1,
    cleanupCouldNotStart: true,
  });
});
