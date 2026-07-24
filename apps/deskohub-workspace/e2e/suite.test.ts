import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { workspaceE2EError } from "./errors";
import type { Runner } from "./runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";
import { runWorkspaceE2ECases } from "./suite";
import { workspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

test("runs checkout and terminal cases concurrently", async () => {
  const telemetryEvents: E2ETelemetryObservation[] = [];
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
      timeoutMs: 10_000,
    },
    {
      execute: ({ session }) =>
        Effect.gen(function* () {
          startedSessions.push(session);
          yield* waitForBothCases();
        }),
      id: "checkout-cowork",
      timeoutMs: 10_000,
    },
  ];
  const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-test-artifacts",
      cases,
      run,
      sessionPrefix: "workspace-e2e-scheduling",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeE2ETelemetryMock(telemetryEvents)))
  );

  expect(startedSessions).toContain("workspace-e2e-scheduling-payment-failed");
  expect(startedSessions).toContain("workspace-e2e-scheduling-checkout-cowork");
  expect(telemetryEvents).toEqual(
    expect.arrayContaining([
      {
        caseId: "payment-failed",
        outcome: "passed",
        scope: "case",
        timeoutMs: 10_000,
      },
      expect.objectContaining({
        caseId: "payment-failed",
        outcome: "passed",
        scope: "case",
      }),
      expect.objectContaining({
        caseId: "checkout-cowork",
        outcome: "passed",
        scope: "case",
      }),
    ])
  );
});

test("cancels sibling cases when the first case fails", async () => {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "workspace-e2e-fail-fast-")
  );
  let startedCaseCount = 0;
  let releaseCases: () => void = () => undefined;
  let siblingInterrupted = false;
  const bothCasesStarted = new Promise<void>((resolveStarted) => {
    releaseCases = resolveStarted;
  });
  const reachStartGate = Effect.promise(async () => {
    startedCaseCount += 1;
    if (startedCaseCount === 2) releaseCases();
    await bothCasesStarted;
  });
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: () =>
        reachStartGate.pipe(
          Effect.andThen(
            Effect.fail(workspaceE2EError("intentional case failure"))
          )
        ),
      id: "first-failure",
      timeoutMs: 10_000,
    },
    {
      execute: () =>
        reachStartGate.pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              siblingInterrupted = true;
            })
          )
        ),
      id: "cancelled-sibling",
      timeoutMs: 10_000,
    },
  ];

  try {
    const telemetryEvents: E2ETelemetryObservation[] = [];
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2ECases({
        artifactRoot,
        cases,
        run: makeTestRunner(),
        sessionPrefix: "workspace-e2e-fail-fast",
        timeouts: workspaceE2ETimeouts,
      }).pipe(Effect.provide(makeE2ETelemetryMock(telemetryEvents)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(siblingInterrupted).toBe(true);
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "first-failure",
          outcome: "failed",
          scope: "case",
        }),
        expect.objectContaining({
          caseId: "cancelled-sibling",
          outcome: "cancelled",
          scope: "case",
        }),
      ])
    );
  } finally {
    await rm(artifactRoot, { force: true, recursive: true });
  }
});

test("reports the semantic step that timed out", async () => {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "workspace-e2e-step-timeout-")
  );
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: ({ runStep }) =>
        runStep({
          execute: Effect.never,
          id: "wait-for-provider",
          timeoutMs: 20,
        }),
      id: "checkout-timeout",
      timeoutMs: 1_000,
    },
  ];

  try {
    const telemetryEvents: E2ETelemetryObservation[] = [];
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2ECases({
        artifactRoot,
        cases,
        run: makeTestRunner(),
        sessionPrefix: "workspace-e2e-timeout",
        timeouts: workspaceE2ETimeouts,
      }).pipe(Effect.provide(makeE2ETelemetryMock(telemetryEvents)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(
        "checkout-timeout/wait-for-provider"
      );
    }
    expect(telemetryEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "checkout-timeout",
          failureKind: "timeout",
          outcome: "timed_out",
          scope: "step",
          stepId: "wait-for-provider",
          timeoutMs: 20,
        }),
        expect.objectContaining({
          caseId: "checkout-timeout",
          failureKind: "timeout",
          outcome: "timed_out",
          scope: "case",
          timeoutMs: 1_000,
        }),
      ])
    );
  } finally {
    await rm(artifactRoot, { force: true, recursive: true });
  }
});

test("propagates browser finalizer failures", async () => {
  const telemetryEvents: E2ETelemetryObservation[] = [];
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: () => Effect.void,
      id: "finalizer-failure",
      timeoutMs: 1_000,
    },
  ];
  const run: Runner = async (_command, args) => {
    if (args.includes("close")) throw new Error("browser close failed");
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const exit = await Effect.runPromiseExit(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-finalizer-test",
      cases,
      run,
      sessionPrefix: "workspace-e2e-finalizer",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeE2ETelemetryMock(telemetryEvents)))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(String(Cause.squash(exit.cause))).toContain(
      "Failed to finalize finalizer-failure e2e case"
    );
  }
  expect(telemetryEvents).toContainEqual({
    caseId: "finalizer-failure",
    failureKind: "defect",
    outcome: "failed",
    scope: "case",
    timeoutMs: 1_000,
  });
});

const makeTestRunner = (): Runner => async (_command, args) => ({
  exitCode: args.includes("har") && args.includes("start") ? 1 : 0,
  stderr: "",
  stdout: "",
});
