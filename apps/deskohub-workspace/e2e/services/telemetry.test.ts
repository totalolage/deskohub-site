import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { workspaceE2ETimeoutError } from "../errors";
import {
  type E2ETelemetryEvent,
  makeE2ERunContext,
  toE2EResult,
  toE2ETelemetryAnnotations,
  withE2ERunTelemetry,
} from "./telemetry";

describe("E2E run context", () => {
  test("defaults local execution to manual", () => {
    expect(
      makeE2ERunContext(makeTestE2EEnvironment(), () => "local-run")
    ).toEqual({
      executionContext: "manual",
      runId: "manual-local-run",
    });
  });

  test("uses explicit CI context and GitHub correlation values", () => {
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "12345",
          TARGET_SHA: "a".repeat(40),
          WORKSPACE_E2E_EXECUTION_CONTEXT: "ci",
          WORKSPACE_E2E_PR_NUMBER: "124",
        })
      )
    ).toEqual({
      executionContext: "ci",
      githubRunAttempt: 2,
      githubRunId: "12345",
      prNumber: 124,
      runId: "12345-2",
      targetSha: "a".repeat(40),
    });
  });

  test("derives the first-rollout fallback from the GitHub trigger", () => {
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "repository_dispatch",
        }),
        () => "ci-run"
      ).executionContext
    ).toBe("ci");
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "workflow_dispatch",
        }),
        () => "manual-run"
      ).executionContext
    ).toBe("manual");
  });
});

test("builds bounded searchable lifecycle annotations", () => {
  expect(
    toE2ETelemetryAnnotations(
      {
        executionContext: "ci",
        githubRunAttempt: 3,
        githubRunId: "987",
        prNumber: 120,
        runId: "987-3",
        targetSha: "b".repeat(40),
      },
      {
        caseId: "checkout-cowork-basic",
        durationMs: 1_234.6,
        failureKind: "error",
        outcome: "failed",
        phase: "finished",
        scope: "step",
        stepId: "complete-hosted-payment",
      }
    )
  ).toEqual({
    "e2e.case.id": "checkout-cowork-basic",
    "e2e.duration_ms": 1235,
    "e2e.event": "step.finished",
    "e2e.execution_context": "ci",
    "e2e.failure.kind": "error",
    "e2e.outcome": "failed",
    "e2e.phase": "finished",
    "e2e.run.id": "987-3",
    "e2e.scope": "step",
    "e2e.step.id": "complete-hosted-payment",
    "git.commit.sha": "b".repeat(40),
    "github.pull_request.number": 120,
    "github.run.attempt": 3,
    "github.run.id": "987",
  });
});

test("maps success, errors, defects, timeouts, and interruption to closed results", () => {
  expect(toE2EResult(Exit.succeed(undefined))).toEqual({
    outcome: "passed",
  });
  expect(toE2EResult(Exit.fail("failed"))).toEqual({
    failureKind: "error",
    outcome: "failed",
  });
  expect(toE2EResult(Exit.die("defect"))).toEqual({
    failureKind: "defect",
    outcome: "failed",
  });
  expect(toE2EResult(Exit.fail(workspaceE2ETimeoutError("timed out")))).toEqual(
    {
      failureKind: "timeout",
      outcome: "timed_out",
    }
  );
  expect(toE2EResult(Exit.failCause(Cause.interrupt(1)))).toEqual({
    outcome: "cancelled",
  });
});

test("records the terminal outcome for the complete run", async () => {
  const events: E2ETelemetryEvent[] = [];
  const times = [1_000, 2_250];
  const telemetry = {
    record: (event: E2ETelemetryEvent) =>
      Effect.sync(() => {
        events.push(event);
      }),
  };

  const exit = await Effect.runPromiseExit(
    withE2ERunTelemetry(
      Effect.fail("suite failed"),
      telemetry,
      () => times.shift() ?? 2_250
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual([
    { phase: "started", scope: "run" },
    {
      durationMs: 1_250,
      failureKind: "error",
      outcome: "failed",
      phase: "finished",
      scope: "run",
    },
  ]);
});

test("records a distinct timeout result for the complete run", async () => {
  const events: E2ETelemetryEvent[] = [];
  const telemetry = {
    record: (event: E2ETelemetryEvent) =>
      Effect.sync(() => {
        events.push(event);
      }),
  };

  await Effect.runPromiseExit(
    withE2ERunTelemetry(
      Effect.fail(workspaceE2ETimeoutError("suite timed out")),
      telemetry,
      () => 1_000
    )
  );

  expect(events).toEqual([
    { phase: "started", scope: "run" },
    {
      durationMs: 0,
      failureKind: "timeout",
      outcome: "timed_out",
      phase: "finished",
      scope: "run",
    },
  ]);
});
