import { afterEach, expect, mock, test } from "bun:test";
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
  WorkspaceE2EAccountCaseCompletion,
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountJournalRef,
} from "./types";

let journalFlushObserver: (() => void) | undefined;
const writeWorkspaceE2EAccountJournal = mock(
  async (_journal: WorkspaceE2EAccountJournal) => journalFlushObserver?.()
);

mock.module("./journal", () => ({ writeWorkspaceE2EAccountJournal }));

afterEach(() => {
  journalFlushObserver = undefined;
});

const { runWorkspaceE2EAccountCase } = await import("./runner");

const rejectUnexpectedHttp = Object.assign(
  async (..._args: Parameters<typeof fetch>) => {
    throw new Error("HTTP must not execute");
  },
  {
    preconnect: (..._args: Parameters<typeof fetch.preconnect>) => undefined,
  }
);

const httpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, rejectUnexpectedHttp))
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

const makeAccountCase = (
  id: WorkspaceE2EAccountCase["id"],
  execute: (
    context: Parameters<WorkspaceE2EAccountCase["execute"]>[0]
  ) => Effect.Effect<
    void | WorkspaceE2EAccountCaseCompletion,
    WorkspaceE2EError
  >,
  timeoutMs = workspaceE2ETimeouts.accountCase
): WorkspaceE2EAccountCase => ({
  execute: (context) =>
    execute(context).pipe(
      Effect.map((completion) =>
        completion === undefined ? { cleanup: Effect.void } : completion
      )
    ),
  id,
  timeoutMs,
});

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
  const events: string[] = [];
  journalFlushObserver = () => events.push("journal:flush");
  const failures: {
    readonly caseId: string;
    readonly failureKind: "defect" | "error" | "timeout";
    readonly outcome: "failed" | "timed_out";
  }[] = [];
  const journalRef = makeJournalRef();
  const failure = workspaceE2EError(
    "verify profile navigation and unsaved changes failed"
  );
  const testCase = makeAccountCase(
    "account-profile-completion",
    ({ runStep }) => {
      const cleanupStep: WorkspaceE2EStep<void> = {
        execute: Effect.sync(() => events.push("case:cleanup")).pipe(
          Effect.asVoid
        ),
        id: "cleanup transition fixture",
        timeoutMs: workspaceE2ETimeouts.providerTransition,
      };
      return Effect.sync(() => events.push("case:execute")).pipe(
        Effect.map(() => ({ cleanup: runStep(cleanupStep) }))
      );
    }
  );
  const verifyPage = {
    execute: Effect.sync(() => events.push("verification:body")).pipe(
      Effect.andThen(Effect.fail(failure))
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

  journalFlushObserver = undefined;
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure);
  expect(events).toEqual([
    "case:execute",
    "verification:body",
    "case:cleanup",
    "journal:flush",
  ]);
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

test("preserves verification failure when case cleanup also fails", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const primaryFailure = workspaceE2EError("verification failed first");
  const cleanupFailure = workspaceE2EError("case cleanup failed");
  const testCase = makeAccountCase(
    "account-profile-completion",
    ({ runStep }) =>
      Effect.succeed({
        cleanup: runStep({
          execute: Effect.fail(cleanupFailure),
          id: "cleanup transition fixture",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        }),
      })
  );

  const exit = await Effect.runPromiseExit(
    runWorkspaceE2EAccountCase({
      journalRef: makeJournalRef(),
      session: "account-runner-test",
      testCase,
      verifyPages: [
        {
          execute: Effect.fail(primaryFailure),
          id: "checks account history",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        },
      ],
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit))
    expect(Cause.squash(exit.cause)).toBe(primaryFailure);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "error",
    outcome: "failed",
    scope: "step",
    stepId: "cleanup transition fixture",
    timeoutMs: workspaceE2ETimeouts.providerTransition,
  });
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("surfaces a cleanup-only failure", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const cleanupFailure = workspaceE2EError("case cleanup failed");
  const testCase = makeAccountCase(
    "account-profile-completion",
    ({ runStep }) =>
      Effect.succeed({
        cleanup: runStep({
          execute: Effect.fail(cleanupFailure),
          id: "cleanup transition fixture",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        }),
      })
  );

  const exit = await Effect.runPromiseExit(
    runWorkspaceE2EAccountCase({
      journalRef: makeJournalRef(),
      session: "account-runner-test",
      testCase,
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit))
    expect(Cause.squash(exit.cause)).toBe(cleanupFailure);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "error",
    outcome: "failed",
    scope: "step",
    stepId: "cleanup transition fixture",
    timeoutMs: workspaceE2ETimeouts.providerTransition,
  });
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("bounds the case cleanup step by its semantic timeout", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const testCase = makeAccountCase(
    "account-profile-completion",
    ({ runStep }) =>
      Effect.succeed({
        cleanup: runStep({
          execute: Effect.sleep("60 seconds"),
          id: "cleanup transition fixture",
          timeoutMs: 1_000,
        }),
      })
  );

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runWorkspaceE2EAccountCase({
          journalRef: makeJournalRef(),
          session: "account-runner-test",
          testCase,
        })
      );
      yield* TestClock.adjust("2 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "timeout",
    outcome: "timed_out",
    scope: "step",
    stepId: "cleanup transition fixture",
    timeoutMs: 1_000,
  });
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("runs verification pages sequentially within their individual timeout", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  const testCase = makeAccountCase("account-profile-completion", () =>
    Effect.sync(() => events.push("case:execute")).pipe(Effect.asVoid)
  );
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

test("keeps case acquisition interruptible", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  journalFlushObserver = () => events.push("journal:flush");
  const testCase = makeAccountCase("account-profile-completion", () =>
    Effect.sync(() => events.push("case:execute")).pipe(
      Effect.andThen(Effect.sleep("60 seconds")),
      Effect.as({
        cleanup: Effect.sync(() => events.push("case:cleanup")).pipe(
          Effect.asVoid
        ),
      })
    )
  );

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runWorkspaceE2EAccountCase({
          journalRef: makeJournalRef(),
          session: "account-runner-test",
          testCase,
        })
      );
      yield* Effect.yieldNow;
      const interruptedPromptly = yield* Effect.raceFirst(
        Fiber.interrupt(fiber).pipe(Effect.as(true)),
        Effect.sleep("1 second").pipe(Effect.as(false))
      );
      yield* TestClock.adjust("60 seconds");
      return {
        caseExit: yield* Fiber.await(fiber),
        interruptedPromptly,
      };
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  journalFlushObserver = undefined;
  expect(result.interruptedPromptly).toBe(true);
  expect(Exit.isFailure(result.caseExit)).toBe(true);
  if (Exit.isFailure(result.caseExit)) {
    expect(Cause.hasInterruptsOnly(result.caseExit.cause)).toBe(true);
  }
  expect(events).toEqual(["case:execute", "journal:flush"]);
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("runs case cleanup after verification and before journal flush", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  journalFlushObserver = () => events.push("journal:flush");
  const testCase = makeAccountCase(
    "account-profile-completion",
    ({ runStep }) => {
      const cleanupStep: WorkspaceE2EStep<void> = {
        execute: Effect.sync(() => events.push("case:cleanup")).pipe(
          Effect.asVoid
        ),
        id: "cleanup transition fixture",
        timeoutMs: workspaceE2ETimeouts.providerTransition,
      };
      return Effect.sync(() => events.push("case:execute")).pipe(
        Effect.map(() => ({ cleanup: runStep(cleanupStep) }))
      );
    }
  );
  const verifyPage: WorkspaceE2EStep<void> = {
    execute: Effect.sync(() => events.push("verification:body")),
    id: "checks account history",
    timeoutMs: workspaceE2ETimeouts.providerTransition,
  };

  const exit = await Effect.runPromiseExit(
    runWorkspaceE2EAccountCase({
      journalRef: makeJournalRef(),
      session: "account-runner-test",
      testCase,
      verifyPages: [verifyPage],
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  journalFlushObserver = undefined;
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(events).toEqual([
    "case:execute",
    "verification:body",
    "case:cleanup",
    "journal:flush",
  ]);
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
});

test("stops verification after a failed page and preserves the failure", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  const failure = workspaceE2EError("second verification failed");
  const testCase = makeAccountCase("account-profile-completion", () =>
    Effect.succeed({
      cleanup: Effect.sync(() => events.push("case:cleanup")).pipe(
        Effect.asVoid
      ),
    }).pipe(Effect.tap(() => Effect.sync(() => events.push("case:execute"))))
  );
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
    "case:cleanup",
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

test("watchdog interrupts verification and releases before journal flush", async () => {
  writeWorkspaceE2EAccountJournal.mockClear();
  const observations: E2ETelemetryObservation[] = [];
  const events: string[] = [];
  journalFlushObserver = () => events.push("journal:flush");
  const testCase = makeAccountCase(
    "account-profile-completion",
    () =>
      Effect.sync(() => events.push("case:execute")).pipe(
        Effect.map(() => ({
          cleanup: Effect.sync(() => events.push("case:cleanup")).pipe(
            Effect.asVoid
          ),
        }))
      ),
    1_000
  );
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
      yield* TestClock.adjust("2 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(makeRunnerLayer(observations)))
  );

  journalFlushObserver = undefined;
  expect(testCase.timeoutMs).toBe(1_000);
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual([
    "case:execute",
    "verification-1:start",
    "verification-1:cancel-finalizer",
    "verification-1:end",
    "case:cleanup",
    "journal:flush",
  ]);
  expect(events).not.toContain("verification-2:start");
  expect(writeWorkspaceE2EAccountJournal).toHaveBeenCalledTimes(1);
  expect(observations).toContainEqual({
    caseId: testCase.id,
    failureKind: "timeout",
    outcome: "timed_out",
    scope: "case",
    timeoutMs: testCase.timeoutMs,
  });
});
