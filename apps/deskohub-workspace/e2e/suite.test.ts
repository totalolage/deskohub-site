import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Layer } from "effect";
import type { DatasourceConfig } from "./config";
import { workspaceE2EError } from "./errors";
import type { Runner } from "./runtime";
import { WorkspaceE2ECleanupService } from "./services/cleanup";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";
import {
  runWorkspaceE2ECases,
  workspaceE2EReservationStartConcurrency,
} from "./suite";
import { workspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

test("runs checkout and terminal cases", async () => {
  const telemetryEvents: E2ETelemetryObservation[] = [];
  const startedSessions: string[] = [];
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: ({ session }) =>
        Effect.sync(() => {
          startedSessions.push(session);
        }),
      checkoutStates: [],
      id: "payment-failed",
      timeoutMs: 10_000,
    },
    {
      execute: ({ session }) =>
        Effect.sync(() => {
          startedSessions.push(session);
        }),
      checkoutStates: [],
      id: "checkout-cowork",
      timeoutMs: 10_000,
    },
  ];
  const run: Runner = async () => ({ exitCode: 0, stderr: "", stdout: "" });

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-test-artifacts",
      cases,
      datasourceConfig: testDatasourceConfig,
      run,
      sessionPrefix: "workspace-e2e-scheduling",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer(telemetryEvents)))
  );

  expect(startedSessions).toContain("workspace-e2e-scheduling-0");
  expect(startedSessions).toContain("workspace-e2e-scheduling-1");
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

test("runs all independent preview cases concurrently", async () => {
  let activeCaseCount = 0;
  let maximumActiveCaseCount = 0;
  const cases: readonly WorkspaceE2ECase[] = Array.from(
    { length: 12 },
    (_, index) => ({
      execute: () =>
        Effect.acquireUseRelease(
          Effect.sync(() => {
            activeCaseCount += 1;
            maximumActiveCaseCount = Math.max(
              maximumActiveCaseCount,
              activeCaseCount
            );
          }),
          () =>
            Effect.promise(
              () => new Promise<void>((resolve) => setTimeout(resolve, 10))
            ),
          () =>
            Effect.sync(() => {
              activeCaseCount -= 1;
            })
        ),
      checkoutStates: [],
      id: `concurrent-${index}`,
      timeoutMs: 10_000,
    })
  );

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-concurrency-test",
      cases,
      datasourceConfig: testDatasourceConfig,
      run: makeTestRunner(),
      sessionPrefix: "workspace-e2e-concurrency",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer()))
  );

  expect(maximumActiveCaseCount).toBe(12);
});

test("bounds reservation starts and admits shorter case deadlines first", async () => {
  const caseCount = workspaceE2EReservationStartConcurrency + 1;
  let activeReservationStarts = 0;
  let maximumActiveReservationStarts = 0;
  let reservationStartCount = 0;
  const admittedCaseIds: string[] = [];
  let releaseFirstWave: () => void = () => undefined;
  let signalCapacityReached: () => void = () => undefined;
  const firstWaveRelease = new Promise<void>((resolve) => {
    releaseFirstWave = resolve;
  });
  const capacityReached = new Promise<void>((resolve) => {
    signalCapacityReached = resolve;
  });
  const cases: readonly WorkspaceE2ECase[] = Array.from(
    { length: caseCount },
    (_, index) => ({
      execute: ({ runStep }) =>
        runStep({
          capacity: "reservation-start",
          execute: Effect.acquireUseRelease(
            Effect.sync(() => {
              activeReservationStarts += 1;
              reservationStartCount += 1;
              admittedCaseIds.push(`reservation-start-${index}`);
              maximumActiveReservationStarts = Math.max(
                maximumActiveReservationStarts,
                activeReservationStarts
              );
              if (
                activeReservationStarts ===
                workspaceE2EReservationStartConcurrency
              ) {
                signalCapacityReached();
              }
            }),
            () => Effect.promise(() => firstWaveRelease),
            () =>
              Effect.sync(() => {
                activeReservationStarts -= 1;
              })
          ),
          id: "prepare-checkout-pay-page",
          timeoutMs: 10_000,
        }),
      checkoutStates: [],
      id: `reservation-start-${index}`,
      timeoutMs: index === caseCount - 1 ? 9_000 : 10_000,
    })
  );

  const suiteRun = Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-reservation-start-capacity-test",
      cases,
      datasourceConfig: testDatasourceConfig,
      run: makeTestRunner(),
      sessionPrefix: "workspace-e2e-reservation-start-capacity",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer()))
  );

  await capacityReached;
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  const startsBeforeRelease = reservationStartCount;
  releaseFirstWave();
  await suiteRun;

  expect(startsBeforeRelease).toBe(workspaceE2EReservationStartConcurrency);
  expect(maximumActiveReservationStarts).toBe(
    workspaceE2EReservationStartConcurrency
  );
  expect(
    admittedCaseIds.slice(0, workspaceE2EReservationStartConcurrency)
  ).toContain(`reservation-start-${caseCount - 1}`);
  expect(reservationStartCount).toBe(caseCount);
});

test("runs shared-fixture cases after the independent parallel phase", async () => {
  const completedCases: string[] = [];
  const cases: readonly WorkspaceE2ECase[] = [
    ...["parallel-a", "parallel-b"].map((id) => ({
      execute: () =>
        Effect.sleep("20 millis").pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              completedCases.push(id);
            })
          )
        ),
      checkoutStates: [],
      id,
      timeoutMs: 10_000,
    })),
    {
      execute: () =>
        Effect.sync(() => {
          completedCases.push("shared-fixture");
        }),
      checkoutStates: [],
      id: "shared-fixture",
      runAfterParallel: true,
      timeoutMs: 10_000,
    },
  ];

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-shared-fixture-test",
      cases,
      datasourceConfig: testDatasourceConfig,
      run: makeTestRunner(),
      sessionPrefix: "workspace-e2e-shared-fixture",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer()))
  );

  expect(new Set(completedCases.slice(0, 2))).toEqual(
    new Set(["parallel-a", "parallel-b"])
  );
  expect(completedCases.at(-1)).toBe("shared-fixture");
});

test("keeps browser session names independent of descriptive case ids", async () => {
  const startedSessions: string[] = [];
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: ({ session }) =>
        Effect.sync(() => {
          startedSessions.push(session);
        }),
      checkoutStates: [],
      id: "discount-code-expires-after-the-customer-reaches-the-payment-page",
      timeoutMs: 10_000,
    },
  ];

  await Effect.runPromise(
    runWorkspaceE2ECases({
      artifactRoot: "/tmp/workspace-e2e-session-name-test",
      cases,
      datasourceConfig: testDatasourceConfig,
      run: makeTestRunner(),
      sessionPrefix: "workspace-e2e-30212233344-1",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer()))
  );

  expect(startedSessions).toEqual(["workspace-e2e-30212233344-1-0"]);
});

test("case failure interrupts siblings while their cleanup and browser finalizers overlap", async () => {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "workspace-e2e-fail-fast-")
  );
  let startedCaseCount = 0;
  let activeCleanupCount = 0;
  let cleanupCallCount = 0;
  let maximumActiveCleanupCount = 0;
  let closedBrowserCount = 0;
  let releaseCases: () => void = () => undefined;
  let releaseCleanup: () => void = () => undefined;
  let siblingInterrupted = false;
  const bothCasesStarted = new Promise<void>((resolveStarted) => {
    releaseCases = resolveStarted;
  });
  const reachStartGate = Effect.promise(async () => {
    startedCaseCount += 1;
    if (startedCaseCount === 2) releaseCases();
    await bothCasesStarted;
  });
  const bothCleanupsStarted = new Promise<void>((resolveStarted) => {
    releaseCleanup = resolveStarted;
  });
  const cleanupLayer = Layer.succeed(WorkspaceE2ECleanupService, {
    cleanupCheckoutStates: () => Effect.succeed(undefined),
    cleanupOwnedCheckoutStates: () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          cleanupCallCount += 1;
          activeCleanupCount += 1;
          maximumActiveCleanupCount = Math.max(
            maximumActiveCleanupCount,
            activeCleanupCount
          );
          if (cleanupCallCount === 2) releaseCleanup();
        }),
        () => Effect.promise(() => bothCleanupsStarted),
        () =>
          Effect.sync(() => {
            activeCleanupCount -= 1;
          })
      ).pipe(Effect.as(undefined)),
  });
  const cases: readonly WorkspaceE2ECase[] = [
    {
      execute: ({ runStep }) =>
        runStep({
          capacity: "reservation-start",
          execute: reachStartGate.pipe(
            Effect.andThen(
              Effect.fail(workspaceE2EError("intentional case failure"))
            )
          ),
          id: "prepare-failing-reservation",
          timeoutMs: 10_000,
        }),
      checkoutStates: [],
      id: "first-failure",
      timeoutMs: 10_000,
    },
    {
      execute: ({ runStep }) =>
        runStep({
          capacity: "reservation-start",
          execute: reachStartGate.pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                siblingInterrupted = true;
              })
            )
          ),
          id: "prepare-interrupted-reservation",
          timeoutMs: 10_000,
        }),
      checkoutStates: [],
      id: "cancelled-sibling",
      timeoutMs: 10_000,
    },
  ];
  const run: Runner = async (_command, args) => {
    if (args.includes("close")) closedBrowserCount += 1;
    return {
      exitCode: args.includes("har") && args.includes("start") ? 1 : 0,
      stderr: "",
      stdout: "",
    };
  };

  try {
    const telemetryEvents: E2ETelemetryObservation[] = [];
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2ECases({
        artifactRoot,
        cases,
        datasourceConfig: testDatasourceConfig,
        run,
        sessionPrefix: "workspace-e2e-fail-fast",
        timeouts: workspaceE2ETimeouts,
      }).pipe(
        Effect.provide(
          Layer.merge(makeE2ETelemetryMock(telemetryEvents), cleanupLayer)
        )
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(
        "intentional case failure"
      );
    }
    expect(siblingInterrupted).toBe(true);
    expect(cleanupCallCount).toBe(2);
    expect(maximumActiveCleanupCount).toBe(2);
    expect(closedBrowserCount).toBe(2);
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

test("retains the genuine failure while interrupted siblings finalize", async () => {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "workspace-e2e-failure-cause-")
  );
  const caseCount = 30;
  let startedCaseCount = 0;
  let releaseCases: () => void = () => undefined;
  const allCasesStarted = new Promise<void>((resolveStarted) => {
    releaseCases = resolveStarted;
  });
  const reachStartGate = Effect.promise(async () => {
    startedCaseCount += 1;
    if (startedCaseCount === caseCount) releaseCases();
    await allCasesStarted;
  });
  const cases: readonly WorkspaceE2ECase[] = Array.from(
    { length: caseCount },
    (_, index) => ({
      execute: () =>
        reachStartGate.pipe(
          Effect.andThen(
            index === 0
              ? Effect.fail(workspaceE2EError("genuine case failure"))
              : Effect.never
          )
        ),
      checkoutStates: [],
      id: index === 0 ? "genuine-failure" : `interrupted-sibling-${index}`,
      timeoutMs: 10_000,
    })
  );
  const run: Runner = async (_command, args) => {
    if (args.includes("eval")) {
      await new Promise<void>((resolveCapture) =>
        setTimeout(resolveCapture, 250)
      );
    }
    return {
      exitCode: args.includes("har") && args.includes("start") ? 1 : 0,
      stderr: "",
      stdout: "",
    };
  };

  try {
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2ECases({
        artifactRoot,
        cases,
        datasourceConfig: testDatasourceConfig,
        run,
        sessionPrefix: "workspace-e2e-failure-cause",
        timeouts: workspaceE2ETimeouts,
      }).pipe(Effect.provide(makeTestSuiteLayer()))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(
        "genuine case failure"
      );
    }
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
      checkoutStates: [],
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
        datasourceConfig: testDatasourceConfig,
        run: makeTestRunner(),
        sessionPrefix: "workspace-e2e-timeout",
        timeouts: workspaceE2ETimeouts,
      }).pipe(Effect.provide(makeTestSuiteLayer(telemetryEvents)))
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
      checkoutStates: [],
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
      datasourceConfig: testDatasourceConfig,
      run,
      sessionPrefix: "workspace-e2e-finalizer",
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer(telemetryEvents)))
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

const testDatasourceConfig = {} as DatasourceConfig;

const makeTestSuiteLayer = (telemetryEvents: E2ETelemetryObservation[] = []) =>
  Layer.merge(
    makeE2ETelemetryMock(telemetryEvents),
    WorkspaceE2ECleanupService.Live
  );
