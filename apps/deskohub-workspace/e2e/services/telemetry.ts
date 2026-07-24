import { randomUUID } from "node:crypto";
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import type { E2EEnvironment } from "../e2e-env";
import { isWorkspaceE2ETimeout } from "../errors";

export type E2EExecutionContext = "ci" | "manual";
export type E2EOutcome = "cancelled" | "failed" | "passed" | "timed_out";
export type E2EFailureKind = "defect" | "error" | "timeout";

export type E2EResult =
  | {
      readonly outcome: "cancelled" | "passed";
    }
  | {
      readonly failureKind: Exclude<E2EFailureKind, "timeout">;
      readonly outcome: "failed";
    }
  | {
      readonly failureKind: "timeout";
      readonly outcome: "timed_out";
    };

type E2EFinishedEvent = {
  readonly durationMs: number;
  readonly phase: "finished";
} & E2EResult;

export type E2ERunContext = {
  readonly executionContext: E2EExecutionContext;
  readonly githubRunAttempt?: number;
  readonly githubRunId?: string;
  readonly prNumber?: number;
  readonly runId: string;
  readonly targetSha?: string;
};

export type E2ETelemetryEvent =
  | {
      readonly phase: "started";
      readonly scope: "run";
    }
  | (E2EFinishedEvent & {
      readonly scope: "run";
    })
  | {
      readonly caseId: string;
      readonly phase: "started";
      readonly scope: "case";
    }
  | (E2EFinishedEvent & {
      readonly caseId: string;
      readonly scope: "case";
    })
  | {
      readonly caseId: string;
      readonly phase: "started";
      readonly scope: "step";
      readonly stepId: string;
    }
  | (E2EFinishedEvent & {
      readonly caseId: string;
      readonly scope: "step";
      readonly stepId: string;
    });

interface IE2ERunContextService {
  readonly value: E2ERunContext;
}

export class E2ERunContextService extends Context.Service<
  E2ERunContextService,
  IE2ERunContextService
>()("E2ERunContextService") {
  static layer = (environment: E2EEnvironment) =>
    Layer.sync(this, () => ({
      value: makeE2ERunContext(environment),
    }));
}

export interface E2ETelemetry {
  readonly record: (event: E2ETelemetryEvent) => Effect.Effect<void>;
}

export class E2ETelemetryService extends Context.Service<
  E2ETelemetryService,
  E2ETelemetry
>()("E2ETelemetryService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { value: runContext } = yield* E2ERunContextService;

      return {
        record: (event) =>
          Effect.logInfo("E2E lifecycle").pipe(
            Effect.annotateLogs(toE2ETelemetryAnnotations(runContext, event))
          ),
      };
    })
  );
}

export const makeE2ERunContext = (
  environment: E2EEnvironment,
  makeManualRunId: () => string = () => randomUUID()
): E2ERunContext => {
  const executionContext = parseE2EExecutionContext(
    environment.WORKSPACE_E2E_EXECUTION_CONTEXT,
    environment.GITHUB_ACTIONS,
    environment.GITHUB_EVENT_NAME
  );
  const githubRunId = environment.GITHUB_RUN_ID;
  const githubRunAttempt = environment.GITHUB_RUN_ATTEMPT;
  const prNumber = environment.WORKSPACE_E2E_PR_NUMBER;
  const targetSha = environment.TARGET_SHA;
  const runId =
    githubRunId && githubRunAttempt
      ? `${githubRunId}-${githubRunAttempt}`
      : `manual-${makeManualRunId()}`;

  return {
    executionContext,
    ...(githubRunAttempt ? { githubRunAttempt } : {}),
    ...(githubRunId ? { githubRunId } : {}),
    ...(prNumber ? { prNumber } : {}),
    runId,
    ...(targetSha ? { targetSha } : {}),
  };
};

const parseE2EExecutionContext = (
  value: E2EEnvironment["WORKSPACE_E2E_EXECUTION_CONTEXT"],
  githubActions: E2EEnvironment["GITHUB_ACTIONS"],
  githubEventName: E2EEnvironment["GITHUB_EVENT_NAME"]
): E2EExecutionContext => {
  if (value) return value;
  if (githubActions === "true")
    return githubEventName === "workflow_dispatch" ? "manual" : "ci";
  return "manual";
};

export const toE2EResult = <A, E>(exit: Exit.Exit<A, E>): E2EResult => {
  if (Exit.isSuccess(exit)) return { outcome: "passed" };
  if (Cause.hasInterruptsOnly(exit.cause)) return { outcome: "cancelled" };

  const error = Cause.findErrorOption(exit.cause);
  if (Option.isSome(error) && isWorkspaceE2ETimeout(error.value)) {
    return { failureKind: "timeout", outcome: "timed_out" };
  }

  return {
    failureKind: Cause.hasDies(exit.cause) ? "defect" : "error",
    outcome: "failed",
  };
};

export const withE2ERunTelemetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  telemetry: E2ETelemetry,
  now: () => number = Date.now
): Effect.Effect<A, E, R> =>
  Effect.suspend(() => {
    const startedAt = now();
    return telemetry.record({ phase: "started", scope: "run" }).pipe(
      Effect.andThen(effect),
      Effect.onExit((exit) =>
        telemetry.record({
          durationMs: now() - startedAt,
          phase: "finished",
          scope: "run",
          ...toE2EResult(exit),
        })
      )
    );
  });

export const toE2ETelemetryAnnotations = (
  runContext: E2ERunContext,
  event: E2ETelemetryEvent
): Record<string, boolean | number | string> => ({
  "e2e.event": `${event.scope}.${event.phase}`,
  "e2e.execution_context": runContext.executionContext,
  "e2e.run.id": runContext.runId,
  "e2e.scope": event.scope,
  "e2e.phase": event.phase,
  ...("outcome" in event ? { "e2e.outcome": event.outcome } : {}),
  ...("failureKind" in event ? { "e2e.failure.kind": event.failureKind } : {}),
  ...("durationMs" in event
    ? { "e2e.duration_ms": Math.max(0, Math.round(event.durationMs)) }
    : {}),
  ...("caseId" in event ? { "e2e.case.id": event.caseId } : {}),
  ...("stepId" in event ? { "e2e.step.id": event.stepId } : {}),
  ...(runContext.githubRunId
    ? { "github.run.id": runContext.githubRunId }
    : {}),
  ...(runContext.githubRunAttempt
    ? { "github.run.attempt": runContext.githubRunAttempt }
    : {}),
  ...(runContext.prNumber
    ? { "github.pull_request.number": runContext.prNumber }
    : {}),
  ...(runContext.targetSha ? { "git.commit.sha": runContext.targetSha } : {}),
});
