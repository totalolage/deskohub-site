import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Layer } from "effect";
import type { DatasourceConfig } from "./config";
import { WorkspaceE2EProviderVerificationPermitServiceMock } from "./coordination/provider-verification-permit.service.mock";
import type { Runner } from "./runtime";
import { WorkspaceE2ECleanupService } from "./services/cleanup";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";
import {
  runWorkspaceE2ECase,
  type WorkspaceE2EFailureDiagnostic,
} from "./suite";
import { workspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

test("runs one Playwright-owned case with a stable isolated session", async () => {
  const telemetryEvents: E2ETelemetryObservation[] = [];
  const startedSessions: string[] = [];
  const testCase: WorkspaceE2ECase = {
    checkoutStates: [],
    execute: ({ session }) => Effect.sync(() => startedSessions.push(session)),
    id: "checkout-cowork",
    timeoutMs: 10_000,
  };

  await Effect.runPromise(
    runWorkspaceE2ECase({
      artifactRoot: "/tmp/workspace-e2e-test-artifacts",
      datasourceConfig: testDatasourceConfig,
      run: makeTestRunner(),
      sessionPrefix: "workspace-e2e-playwright",
      testCase,
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer(telemetryEvents)))
  );

  expect(startedSessions).toEqual(["workspace-e2e-playwright-checkout-cowork"]);
  expect(telemetryEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        caseId: "checkout-cowork",
        outcome: "passed",
        scope: "case",
      }),
    ])
  );
});

test("reports the semantic step that timed out", async () => {
  const artifactRoot = await mkdtemp(
    resolve(tmpdir(), "workspace-e2e-step-timeout-")
  );
  const testCase: WorkspaceE2ECase = {
    checkoutStates: [],
    execute: ({ runStep }) =>
      runStep({
        execute: Effect.never,
        id: "wait-for-provider",
        timeoutMs: 20,
      }),
    id: "checkout-timeout",
    timeoutMs: 1_000,
  };

  try {
    const telemetryEvents: E2ETelemetryObservation[] = [];
    const failureDiagnostics: WorkspaceE2EFailureDiagnostic[] = [];
    const exit = await Effect.runPromiseExit(
      runWorkspaceE2ECase({
        artifactRoot,
        datasourceConfig: testDatasourceConfig,
        reportFailure: (diagnostic) => failureDiagnostics.push(diagnostic),
        run: makeTestRunner(),
        sessionPrefix: "workspace-e2e-timeout",
        testCase,
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
      ])
    );
    expect(failureDiagnostics).toEqual([
      {
        caseId: "checkout-timeout",
        failureKind: "timeout",
        outcome: "timed_out",
        stepId: "wait-for-provider",
      },
    ]);
  } finally {
    await rm(artifactRoot, { force: true, recursive: true });
  }
});

test("stops HAR capture before closing the browser session", async () => {
  const finalizerOperations: string[] = [];
  const testCase: WorkspaceE2ECase = {
    checkoutStates: [],
    execute: () => Effect.void,
    id: "har-finalizer-order",
    timeoutMs: 1_000,
  };
  const run: Runner = async (_command, args) => {
    if (
      args.includes("network") &&
      args.includes("har") &&
      args.includes("stop")
    ) {
      finalizerOperations.push("har-stop");
    }
    if (args.includes("close")) finalizerOperations.push("browser-close");
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    runWorkspaceE2ECase({
      artifactRoot: "/tmp/workspace-e2e-har-finalizer-order-test",
      datasourceConfig: testDatasourceConfig,
      run,
      sessionPrefix: "workspace-e2e-har-finalizer-order",
      testCase,
      timeouts: workspaceE2ETimeouts,
    }).pipe(Effect.provide(makeTestSuiteLayer()))
  );

  expect(finalizerOperations).toEqual(["har-stop", "browser-close"]);
});

test("overlaps reservation cleanup with browser finalization", async () => {
  let cleanupActive = false;
  let browserClosedDuringCleanup = false;
  let resolveCleanupStarted: () => void = () => undefined;
  const cleanupStarted = new Promise<void>((resolveStarted) => {
    resolveCleanupStarted = resolveStarted;
  });
  const cleanupLayer = Layer.succeed(WorkspaceE2ECleanupService, {
    cleanupCheckoutStates: () => Effect.succeed(undefined),
    cleanupOwnedCheckoutStates: () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          cleanupActive = true;
          resolveCleanupStarted();
        }),
        () => Effect.sleep("50 millis"),
        () =>
          Effect.sync(() => {
            cleanupActive = false;
          })
      ).pipe(Effect.as(undefined)),
  });
  const run: Runner = async (_command, args) => {
    if (args.includes("close")) {
      await Promise.race([
        cleanupStarted,
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 250)),
      ]);
      if (cleanupActive) browserClosedDuringCleanup = true;
    }
    return {
      exitCode: args.includes("har") && args.includes("start") ? 1 : 0,
      stderr: "",
      stdout: "",
    };
  };

  await Effect.runPromise(
    runWorkspaceE2ECase({
      artifactRoot: "/tmp/workspace-e2e-parallel-finalizer-test",
      datasourceConfig: testDatasourceConfig,
      run,
      sessionPrefix: "workspace-e2e-parallel-finalizer",
      testCase: {
        checkoutStates: [],
        execute: () => Effect.void,
        id: "parallel-finalizer",
        timeoutMs: 1_000,
      },
      timeouts: workspaceE2ETimeouts,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeE2ETelemetryMock([]),
          cleanupLayer,
          WorkspaceE2EProviderVerificationPermitServiceMock
        )
      )
    )
  );

  expect(browserClosedDuringCleanup).toBe(true);
});

test("propagates browser finalizer failures", async () => {
  const telemetryEvents: E2ETelemetryObservation[] = [];
  const failureDiagnostics: WorkspaceE2EFailureDiagnostic[] = [];
  const testCase: WorkspaceE2ECase = {
    checkoutStates: [],
    execute: () => Effect.void,
    id: "finalizer-failure",
    timeoutMs: 1_000,
  };
  const run: Runner = async (_command, args) => {
    if (args.includes("close")) throw new Error("browser close failed");
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const exit = await Effect.runPromiseExit(
    runWorkspaceE2ECase({
      artifactRoot: "/tmp/workspace-e2e-finalizer-test",
      datasourceConfig: testDatasourceConfig,
      reportFailure: (diagnostic) => failureDiagnostics.push(diagnostic),
      run,
      sessionPrefix: "workspace-e2e-finalizer",
      testCase,
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
  expect(failureDiagnostics).toEqual([
    {
      caseId: "finalizer-failure",
      failureKind: "defect",
      outcome: "failed",
    },
  ]);
});

const makeTestRunner = (): Runner => async (_command, args) => ({
  exitCode: args.includes("har") && args.includes("start") ? 1 : 0,
  stderr: "",
  stdout: "",
});

const testDatasourceConfig = {} as DatasourceConfig;

const makeTestSuiteLayer = (telemetryEvents: E2ETelemetryObservation[] = []) =>
  Layer.mergeAll(
    makeE2ETelemetryMock(telemetryEvents),
    WorkspaceE2ECleanupService.Live,
    WorkspaceE2EProviderVerificationPermitServiceMock
  );
