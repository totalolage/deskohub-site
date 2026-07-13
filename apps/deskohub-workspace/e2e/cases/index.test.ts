import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Runner } from "../runtime";
import type { WorkspaceE2ECase } from "../types";
import { runWorkspaceE2ECases } from ".";

test("runs checkout and terminal cases without an execution gate", async () => {
  const startedSessions: string[] = [];
  let startedCaseCount = 0;
  let releaseCases: () => void = () => undefined;
  const bothCasesStarted = new Promise<void>((resolve) => {
    releaseCases = resolve;
  });
  const waitForBothCases = () =>
    Effect.promise(async () => {
      startedCaseCount += 1;
      if (startedCaseCount === 2) releaseCases();
      await bothCasesStarted;
    });
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: ({ session }) =>
        Effect.gen(function* () {
          startedSessions.push(session);
          yield* waitForBothCases();
        }),
      id: "payment-failed",
    },
    {
      execute: ({ session }) =>
        Effect.gen(function* () {
          startedSessions.push(session);
          yield* waitForBothCases();
        }),
      id: "checkout-cowork",
    },
  ];
  const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-test-artifacts",
      cases,
      run,
      sessionPrefix: "workspace-e2e-scheduling",
    })
  );

  expect(startedSessions).toContain("workspace-e2e-scheduling-payment-failed");
  expect(startedSessions).toContain("workspace-e2e-scheduling-checkout-cowork");
});
