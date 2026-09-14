import { expect, mock, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { workspaceE2EError } from "../errors";
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

test("finalizes and reports a failed verify page step", async () => {
  const observations: E2ETelemetryObservation[] = [];
  const failures: {
    readonly caseId: string;
    readonly failureKind: "defect" | "error" | "timeout";
    readonly outcome: "failed" | "timed_out";
  }[] = [];
  const journal = {
    authUserIds: [],
    completed: false,
    dotyposCustomerIds: [],
    dotyposReservationIds: [],
    laneId: "account-lane",
    startedAt: "2026-09-05T00:00:00.000Z",
    version: 1,
  } satisfies WorkspaceE2EAccountJournal;
  const journalRef: WorkspaceE2EAccountJournalRef = {
    journal,
    record: async () => undefined,
  };
  const testCase: WorkspaceE2EAccountCase = {
    execute: () => Effect.void,
    id: "account-profile-completion",
    timeoutMs: workspaceE2ETimeouts.accountCase,
  };
  const verifyPage: WorkspaceE2EStep<void> = {
    execute: Effect.fail(
      workspaceE2EError("verify profile navigation and unsaved changes failed")
    ),
    id: "checks profile re-entry and unsaved navigation",
    timeoutMs: workspaceE2ETimeouts.providerTransition,
  };
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, (() =>
        Promise.reject(new Error("HTTP must not execute"))) as typeof fetch)
    )
  );

  const exit = await Effect.runPromiseExit(
    runWorkspaceE2EAccountCase({
      journalRef,
      reportFailure: (failure) => failures.push(failure),
      session: "account-runner-test",
      testCase,
      verifyPage,
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
