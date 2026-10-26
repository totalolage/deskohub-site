import { describe, expect, test } from "bun:test";
import { Cause, Clock, Effect, Exit, Fiber, Layer } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { runE2ECase, type WorkspaceE2EStepRunner } from "./case-runner";
import { WorkspaceE2EProviderVerificationPermitService } from "./coordination/provider-verification-permit.service";
import { type WorkspaceE2EError, workspaceE2EError } from "./errors";
import { formatWorkspaceE2EFailureAnnotation } from "./github-actions";
import type { E2ETelemetry } from "./services/telemetry";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "./services/telemetry.mock";

const caseId = "runner-case";

const runCase = (
  input: {
    readonly body: (
      step: WorkspaceE2EStepRunner
    ) => Effect.Effect<void, WorkspaceE2EError>;
    readonly cleanup?: Effect.Effect<void, WorkspaceE2EError>;
    readonly onFailure?: (
      cause: Cause.Cause<WorkspaceE2EError>
    ) => Effect.Effect<void>;
    readonly watchdogMs?: number;
  },
  observations: E2ETelemetryObservation[],
  telemetry: Partial<E2ETelemetry> = {}
) =>
  Effect.runPromiseExit(
    withInstantSleeps(runE2ECase({ caseId, watchdogMs: 1_000, ...input })).pipe(
      Effect.provide(makeE2ETelemetryMock(observations, telemetry))
    )
  );

const annotations = (observations: readonly E2ETelemetryObservation[]) =>
  observations.filter((observation) => observation.scope === "annotation");

describe("case outcomes", () => {
  test("passes a case whose steps pass and annotates nothing", async () => {
    const observations: E2ETelemetryObservation[] = [];

    const exit = await runCase(
      {
        body: (step) =>
          step({ execute: Effect.void, id: "open-page", timeoutMs: 100 }),
      },
      observations
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(observations).toEqual([
      {
        caseId,
        outcome: "passed",
        scope: "step",
        stepId: "open-page",
        timeoutMs: 100,
      },
      { caseId, outcome: "passed", scope: "case", timeoutMs: 1_000 },
    ]);
  });

  test("annotates a failed step with its id and allowlisted diagnostic code", async () => {
    const observations: E2ETelemetryObservation[] = [];
    const failure = workspaceE2EError("webhook replay failed", {
      diagnosticCode: "nexi_webhook_fulfillment_failed",
    });

    const exit = await runCase(
      {
        body: (step) =>
          Effect.gen(function* () {
            yield* step({
              execute: Effect.void,
              id: "open-page",
              timeoutMs: 100,
            });
            yield* step({
              execute: Effect.fail(failure),
              id: "replay-webhook",
              timeoutMs: 100,
            });
          }),
      },
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(failure);
    expect(annotations(observations)).toEqual([
      {
        caseId,
        diagnosticCode: "nexi_webhook_fulfillment_failed",
        failureKind: "error",
        outcome: "failed",
        scope: "annotation",
        stepId: "replay-webhook",
      },
    ]);
  });

  test("writes the terminal step through the production annotation formatter", async () => {
    const written: string[] = [];

    await runCase(
      {
        body: (step) =>
          step({
            execute: Effect.fail(workspaceE2EError("navigation failed")),
            id: "verify-profile-navigation",
            timeoutMs: 100,
          }),
      },
      [],
      {
        annotateFailure: (diagnostic) =>
          Effect.sync(() => {
            written.push(formatWorkspaceE2EFailureAnnotation(diagnostic));
          }),
      }
    );

    expect(written).toHaveLength(1);
    expect(written[0]).toEndWith(
      "::case=runner-case,step=verify-profile-navigation,outcome=failed,failure_kind=error\n"
    );
  });

  test("annotates a step timeout as timed out with the step id", async () => {
    const observations: E2ETelemetryObservation[] = [];

    const exit = await runCase(
      {
        body: (step) =>
          step({
            execute: Effect.never,
            id: "wait-for-provider",
            timeoutMs: 20,
          }),
      },
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.squash(exit.cause) as WorkspaceE2EError;
      expect(failure.reason).toBe("timeout");
      expect(failure.operation).toBe(`${caseId}/wait-for-provider`);
    }
    expect(observations).toContainEqual({
      caseId,
      failureKind: "timeout",
      outcome: "timed_out",
      scope: "step",
      stepId: "wait-for-provider",
      timeoutMs: 20,
    });
    expect(annotations(observations)).toEqual([
      {
        caseId,
        failureKind: "timeout",
        outcome: "timed_out",
        scope: "annotation",
        stepId: "wait-for-provider",
      },
    ]);
  });

  test("times the case out at its watchdog and names the interrupted step", async () => {
    const observations: E2ETelemetryObservation[] = [];
    const events: string[] = [];

    const exit = await runCase(
      {
        body: (step) =>
          Effect.gen(function* () {
            yield* step({
              execute: Effect.never.pipe(
                Effect.onInterrupt(() =>
                  Effect.sync(() => events.push("step:interrupted"))
                )
              ),
              id: "wait-for-status",
              timeoutMs: 10_000,
            });
            yield* Effect.sync(() => events.push("next-step"));
          }),
        cleanup: Effect.sync(() => {
          events.push("cleanup");
        }),
        watchdogMs: 30,
      },
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(events).toEqual(["step:interrupted", "cleanup"]);
    expect(observations).toContainEqual({
      caseId,
      outcome: "cancelled",
      scope: "step",
      stepId: "wait-for-status",
      timeoutMs: 10_000,
    });
    expect(observations).toContainEqual({
      caseId,
      failureKind: "timeout",
      outcome: "timed_out",
      scope: "case",
      timeoutMs: 30,
    });
    expect(annotations(observations)).toEqual([
      {
        caseId,
        failureKind: "timeout",
        outcome: "timed_out",
        scope: "annotation",
        stepId: "wait-for-status",
      },
    ]);
  });

  test("cancels an interrupted case after cleanup and annotates nothing", async () => {
    const observations: E2ETelemetryObservation[] = [];
    const events: string[] = [];
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });

    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          runE2ECase({
            body: (step) =>
              step({
                execute: Effect.sync(() => release()).pipe(
                  Effect.andThen(Effect.never)
                ),
                id: "fill-form",
                timeoutMs: 10_000,
              }),
            caseId,
            cleanup: Effect.sync(() => {
              events.push("cleanup");
            }),
            onFailure: () =>
              Effect.sync(() => {
                events.push("on-failure");
              }),
            watchdogMs: 10_000,
          })
        );
        yield* Effect.promise(() => started);
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(events).toEqual(["cleanup"]);
    expect(observations).toContainEqual({
      caseId,
      outcome: "cancelled",
      scope: "case",
      timeoutMs: 10_000,
    });
    expect(annotations(observations)).toEqual([]);
  });

  test("classifies a dying cleanup as a failed defect", async () => {
    const observations: E2ETelemetryObservation[] = [];

    const exit = await runCase(
      {
        body: () => Effect.void,
        cleanup: Effect.die(new Error("browser close failed")),
      },
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(observations).toContainEqual({
      caseId,
      failureKind: "defect",
      outcome: "failed",
      scope: "case",
      timeoutMs: 1_000,
    });
    expect(annotations(observations)).toEqual([
      { caseId, failureKind: "defect", outcome: "failed", scope: "annotation" },
    ]);
  });
});

describe("case finalization", () => {
  test("runs cleanup, then settles the case span, then annotates once", async () => {
    const observations: E2ETelemetryObservation[] = [];
    const cleanupFailure = workspaceE2EError("cleanup failed");

    const exit = await runCase(
      {
        body: () => Effect.void,
        cleanup: Effect.fail(cleanupFailure),
      },
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(cleanupFailure);
    }
    expect(observations.map(({ scope }) => scope)).toEqual([
      "phase",
      "case",
      "annotation",
    ]);
    expect(observations).toEqual([
      {
        caseId,
        failureKind: "error",
        outcome: "failed",
        phaseId: "case-finalization",
        scope: "phase",
      },
      {
        caseId,
        failureKind: "error",
        outcome: "failed",
        scope: "case",
        timeoutMs: 1_000,
      },
      { caseId, failureKind: "error", outcome: "failed", scope: "annotation" },
    ]);
  });

  test("runs onFailure with the body failure before cleanup, and never on success", async () => {
    const events: string[] = [];
    const failure = workspaceE2EError("submit failed");
    const hooks = {
      cleanup: Effect.sync(() => {
        events.push("cleanup");
      }),
      onFailure: (cause: Cause.Cause<WorkspaceE2EError>) =>
        Effect.sync(() => {
          events.push(`on-failure:${Cause.squash(cause) === failure}`);
        }),
    };

    await runCase({ ...hooks, body: () => Effect.void }, []);
    expect(events).toEqual(["cleanup"]);

    events.length = 0;
    const exit = await runCase(
      {
        ...hooks,
        body: (step) =>
          step({ execute: Effect.fail(failure), id: "submit", timeoutMs: 100 }),
      },
      []
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(events).toEqual(["on-failure:true", "cleanup"]);
  });

  test.each([
    [
      "inside its Effect",
      (): Effect.Effect<void> =>
        Effect.sync(() => {
          throw new Error("stdout closed");
        }),
    ],
    [
      "before returning its Effect",
      (): Effect.Effect<void> => {
        throw new Error("adapter broken");
      },
    ],
  ])(
    "keeps the case failure when the annotation writer throws %s",
    async (_, annotateFailure) => {
      const failure = workspaceE2EError("assertion failed");

      const exit = await runCase(
        {
          body: (step) =>
            step({
              execute: Effect.fail(failure),
              id: "assert",
              timeoutMs: 100,
            }),
        },
        [],
        { annotateFailure }
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(false);
        expect(Cause.squash(exit.cause)).toBe(failure);
      }
    }
  );

  test("lets a failing cleanup replace the body or watchdog failure", async () => {
    const observations: E2ETelemetryObservation[] = [];
    const cleanupFailure = workspaceE2EError("journal flush failed");

    const failed = await runCase(
      {
        body: (step) =>
          step({
            execute: Effect.fail(workspaceE2EError("verification failed")),
            id: "verify",
            timeoutMs: 100,
          }),
        cleanup: Effect.fail(cleanupFailure),
      },
      []
    );
    const timedOut = await runCase(
      {
        body: () => Effect.never,
        cleanup: Effect.fail(cleanupFailure),
        watchdogMs: 20,
      },
      observations
    );

    for (const exit of [failed, timedOut]) {
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBe(cleanupFailure);
      }
    }
    expect(annotations(observations)).toEqual([
      { caseId, failureKind: "error", outcome: "failed", scope: "annotation" },
    ]);
  });

  test("reports the last step that did not pass", async () => {
    const observations: E2ETelemetryObservation[] = [];

    await runCase(
      {
        body: (step) =>
          Effect.gen(function* () {
            yield* step({
              execute: Effect.fail(workspaceE2EError("first attempt failed")),
              id: "first-attempt",
              timeoutMs: 100,
            }).pipe(Effect.ignore);
            yield* step({
              execute: Effect.fail(workspaceE2EError("retry failed")),
              id: "retry",
              timeoutMs: 100,
            });
          }),
      },
      observations
    );

    expect(annotations(observations)).toEqual([
      expect.objectContaining({ stepId: "retry" }),
    ]);
  });
});

describe("step permits", () => {
  /** Records an event with the TestClock time it happened at. */
  const record = Effect.fn(function* (events: string[], event: string) {
    const now = yield* Clock.currentTimeMillis;
    events.push(`${event}@${now}`);
  });

  const runPermittedCase = (
    body: (
      step: WorkspaceE2EStepRunner
    ) => Effect.Effect<
      void,
      WorkspaceE2EError,
      WorkspaceE2EProviderVerificationPermitService
    >,
    events: string[],
    observations: E2ETelemetryObservation[]
  ) =>
    Effect.runPromiseExit(
      withInstantSleeps(runE2ECase({ body, caseId, watchdogMs: 1_000 })).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeE2ETelemetryMock(observations),
            // Admission waits 60 ms, longer than any permitted step's deadline.
            Layer.succeed(WorkspaceE2EProviderVerificationPermitService, {
              withPermit: (effect) =>
                record(events, "permit:wait").pipe(
                  Effect.andThen(Effect.sleep("60 millis")),
                  Effect.andThen(record(events, "permit:admitted")),
                  Effect.andThen(effect),
                  Effect.ensuring(record(events, "permit:released"))
                ),
            })
          )
        )
      )
    );

  test("admits a provider-verification step before its deadline starts", async () => {
    const events: string[] = [];
    const observations: E2ETelemetryObservation[] = [];

    const exit = await runPermittedCase(
      (step) =>
        Effect.gen(function* () {
          yield* step({
            execute: Effect.sleep("20 millis").pipe(
              Effect.andThen(record(events, "replay"))
            ),
            id: "replay-payment-webhook",
            permit: "provider-verification",
            timeoutMs: 30,
          });
          yield* step({
            execute: record(events, "unpermitted"),
            id: "complete-fulfillment",
            timeoutMs: 30,
          });
        }),
      events,
      observations
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(events).toEqual([
      "permit:wait@0",
      "permit:admitted@60",
      "replay@80",
      "permit:released@80",
      "unpermitted@80",
    ]);
    expect(observations).toContainEqual({
      caseId,
      outcome: "passed",
      scope: "step",
      stepId: "replay-payment-webhook",
      timeoutMs: 30,
    });
  });

  test("times a permitted step out at its deadline after admission", async () => {
    const events: string[] = [];
    const observations: E2ETelemetryObservation[] = [];

    const exit = await runPermittedCase(
      (step) =>
        step({
          execute: Effect.never,
          id: "replay-payment-webhook",
          permit: "provider-verification",
          timeoutMs: 30,
        }),
      events,
      observations
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.squash(exit.cause) as WorkspaceE2EError;
      expect(failure.reason).toBe("timeout");
      expect(failure.operation).toBe(`${caseId}/replay-payment-webhook`);
    }
    expect(events).toEqual([
      "permit:wait@0",
      "permit:admitted@60",
      "permit:released@90",
    ]);
    expect(observations).toContainEqual({
      caseId,
      failureKind: "timeout",
      outcome: "timed_out",
      scope: "step",
      stepId: "replay-payment-webhook",
      timeoutMs: 30,
    });
  });

  test("requires the permit service only from cases with a permitted step", () => {
    const permitted = runE2ECase({
      body: (step) =>
        step({
          execute: Effect.void,
          id: "replay-payment-webhook",
          permit: "provider-verification",
          timeoutMs: 30,
        }),
      caseId,
      watchdogMs: 1_000,
    }).pipe(Effect.provide(makeE2ETelemetryMock([])));
    const unpermitted = runE2ECase({
      body: (step) =>
        step({ execute: Effect.void, id: "open-page", timeoutMs: 30 }),
      caseId,
      watchdogMs: 1_000,
    }).pipe(Effect.provide(makeE2ETelemetryMock([])));

    // @ts-expect-error The permitted step needs the provider-verification permit.
    const unprovided: Effect.Effect<void, WorkspaceE2EError> = permitted;
    const provided: Effect.Effect<void, WorkspaceE2EError> = unpermitted;
    expect([unprovided, provided]).toHaveLength(2);
  });
});
