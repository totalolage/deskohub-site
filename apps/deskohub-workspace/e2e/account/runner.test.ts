import { expect, mock, test } from "bun:test";
import { Cause, Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { E2ETelemetryObservation } from "../services/telemetry.mock";
import { makeE2ETelemetryMock } from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStep } from "../types";
import type { WorkspaceE2EAccountJournal } from "./journal";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountJournalRef,
} from "./types";

const writeWorkspaceE2EAccountJournal = mock(
  async (_journal: WorkspaceE2EAccountJournal) => undefined
);

mock.module("./journal", () => ({ writeWorkspaceE2EAccountJournal }));

const { runWorkspaceE2EAccountCase } = await import("./runner");

const httpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(
    Layer.succeed(FetchHttpClient.Fetch, (() =>
      Promise.reject(new Error("HTTP must not execute"))) as typeof fetch)
  )
);

const makeJournalRef = (): WorkspaceE2EAccountJournalRef => ({
  journal: {
    authUserIds: [],
    completed: false,
    dotyposCustomerIds: [],
    dotyposReservationIds: [],
    laneId: "account-lane",
    startedAt: "2026-09-05T00:00:00.000Z",
    version: 1,
  } satisfies WorkspaceE2EAccountJournal,
  record: async () => undefined,
});

const makeRunnerLayer = (observations: E2ETelemetryObservation[]) =>
  Layer.mergeAll(
    makeE2ETelemetryMock(observations),
    Layer.succeed(E2EDatabase, E2EDatabase.of({ db: {} as never })),
    httpClientLayer,
    TestClock.layer()
  );

const makeVerificationStep = (
  id: string,
  events: string[],
  effect: Effect.Effect<void, WorkspaceE2EError> = Effect.sleep("60 seconds"),
  onInterrupt?: () => void
): WorkspaceE2EStep<void> => ({
  execute: Effect.sync(() => events.push(`${id}:start`)).pipe(
    Effect.andThen(effect),
    Effect.onInterrupt(() => Effect.sync(() => onInterrupt?.())),
    Effect.onExit(() => Effect.sync(() => events.push(`${id}:end`)))
  ),
  id,
  timeoutMs: workspaceE2ETimeouts.providerTransition,
});

test("finalizes and reports a failed verification step", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const failures: {
    readonly caseId: string;
    readonly failureKind: "defect" | "error" | "timeout";
    readonly outcome: "failed" | "timed_out";
  }[] = [];
  const journalRef = makeJournalRef();
  const testCase: WorkspaceE2EAccountCase = {
    execute: () => Effect.void,
    id: "account-profile-completion",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  };
  const verifyPage = {
    execute: Effect.fail(
      workspaceE2EError("verify profile navigation and unsaved changes failed")
    ),
    id: "checks profile re-entry and unsaved navigation",
    timeoutMs: workspaceE2ETimeouts.providerTransition,
  };
  const exit = await Effect.runPromiseExit(
    runWorkspaceE2EAccountCase({
      journalRef,
      reportFailure: (failure) => failures.push(failure),
      session: "account-runner-test",
      testCase,
      verifyPages: [verifyPage],
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          makeE2ETelemetryMock(observations),
          Layer.succeed(E2EDatabase, E2EDatabase.of({ db: {} as never })),
          httpClientLayer
        )
      )
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "error",
    outcome: "failed",
    scope: "step",
    stepId: verifyPage.id,
    timeoutMs: verifyPage.timeoutMs,
  });
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "error",
    outcome: "failed",
    scope: "case",
    timeoutMs: testCase.timeoutMs,
  });
  expect(observations).toContainEqual({
    caseId: testCase.id,
    outcome: "passed",
    phaseId: "case-finalization",
    scope: "phase",
  });
  expect(failures).toEqual([
    {
      caseId: testCase.id,
      failureKind: "error",
      outcome: "failed",
    },
  ]);
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("runs verification pages sequentially within their individual timeout", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  const testCase: WorkspaceE2EAccountCase = {
    execute: () => Effect.sync(() => events.push("case:execute")),
    id: "account-profile-completion",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  };
  const verifyPages = [
    makeVerificationStep("verification-1", events),
    makeVerificationStep("verification-2", events),
    makeVerificationStep("verification-3", events),
  ];

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runWorkspaceE2EAccountCase({
          journalRef: makeJournalRef(),
          session: "account-runner-test",
          testCase,
          verifyPages,
        })
      );
      yield* TestClock.adjust("180 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(Exit.isSuccess(exit)).toBe(true);
  expect(events).toEqual([
    "case:execute",
    "verification-1:start",
    "verification-1:end",
    "verification-2:start",
    "verification-2:end",
    "verification-3:start",
    "verification-3:end",
  ]);
  expect(
    observations.filter((observation) => observation.scope === "step")
  ).toEqual(
    verifyPages.map((step) => ({
      caseId: testCase.id,
      outcome: "passed",
      scope: "step",
      stepId: step.id,
      timeoutMs: workspaceE2ETimeouts.providerTransition,
    }))
  );
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("stops verification after a failed page and preserves the failure", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  const failure = workspaceE2EError("second verification failed");
  const testCase: WorkspaceE2EAccountCase = {
    execute: () => Effect.sync(() => events.push("case:execute")),
    id: "account-profile-completion",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  };
  const verifyPages = [
    makeVerificationStep("verification-1", events),
    makeVerificationStep("verification-2", events, Effect.fail(failure)),
    makeVerificationStep("verification-3", events),
  ];

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runWorkspaceE2EAccountCase({
          journalRef: makeJournalRef(),
          reportFailure: (reported) =>
            events.push(`reported:${reported.outcome}`),
          session: "account-runner-test",
          testCase,
          verifyPages,
        })
      );
      yield* TestClock.adjust("60 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  expect(Cause.squash(exit.cause)).toBe(failure);
  expect(events).toEqual([
    "case:execute",
    "verification-1:start",
    "verification-1:end",
    "verification-2:start",
    "verification-2:end",
    "reported:failed",
  ]);
  expect(
    observations.filter((observation) => observation.scope === "step")
  ).toEqual([
    {
      caseId: testCase.id,
      outcome: "passed",
      scope: "step",
      stepId: "verification-1",
      timeoutMs: workspaceE2ETimeouts.providerTransition,
    },
    {
      caseId: testCase.id,
      failureKind: "error",
      outcome: "failed",
      scope: "step",
      stepId: "verification-2",
      timeoutMs: workspaceE2ETimeouts.providerTransition,
    },
  ]);
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("watchdog interrupts verification after case execution consumes its budget", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  const testCase: WorkspaceE2EAccountCase = {
    execute: () => Effect.sleep("1050 seconds"),
    id: "account-profile-completion",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  };
  const verifyPages = [
    makeVerificationStep(
      "verification-1",
      events,
      Effect.sleep("60 seconds"),
      () => events.push("verification-1:cancel-finalizer")
    ),
    makeVerificationStep("verification-2", events),
  ];

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runWorkspaceE2EAccountCase({
          journalRef: makeJournalRef(),
          session: "account-runner-test",
          testCase,
          verifyPages,
        })
      );
      yield* TestClock.adjust("18 minutes");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(testCase.timeoutMs).toBe(18 * 60 * 1_000);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toContain("verification-1:start");
  expect(events).toContain("verification-1:cancel-finalizer");
  expect(events).not.toContain("verification-2:start");
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "timeout",
    outcome: "timed_out",
    scope: "case",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  });
});
