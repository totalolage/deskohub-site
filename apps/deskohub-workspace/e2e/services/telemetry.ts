import { randomUUID } from "node:crypto";
import { Cause, Context, Effect, Exit, Layer } from "effect";

export type E2EExecutionContext = "ci" | "manual";
export type E2EOutcome = "cancelled" | "failed" | "passed";

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
  | {
      readonly durationMs: number;
      readonly outcome: E2EOutcome;
      readonly phase: "finished";
      readonly scope: "run";
    }
  | {
      readonly caseId: string;
      readonly phase: "started";
      readonly scope: "case";
    }
  | {
      readonly caseId: string;
      readonly durationMs: number;
      readonly outcome: E2EOutcome;
      readonly phase: "finished";
      readonly scope: "case";
    }
  | {
      readonly caseId: string;
      readonly phase: "started";
      readonly scope: "step";
      readonly stepId: string;
    }
  | {
      readonly caseId: string;
      readonly durationMs: number;
      readonly outcome: E2EOutcome;
      readonly phase: "finished";
      readonly scope: "step";
      readonly stepId: string;
    };

interface IE2ERunContextService {
  readonly value: E2ERunContext;
}

export class E2ERunContextService extends Context.Service<
  E2ERunContextService,
  IE2ERunContextService
>()("E2ERunContextService") {
  static Live = Layer.sync(this, () => ({
    value: makeE2ERunContext(process.env),
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
  environment: NodeJS.ProcessEnv,
  makeManualRunId: () => string = () => randomUUID()
): E2ERunContext => {
  const executionContext = parseE2EExecutionContext(
    environment.WORKSPACE_E2E_EXECUTION_CONTEXT,
    environment.GITHUB_ACTIONS,
    environment.GITHUB_EVENT_NAME
  );
  const githubRunId = nonEmpty(environment.GITHUB_RUN_ID);
  const githubRunAttempt = positiveInteger(environment.GITHUB_RUN_ATTEMPT);
  const prNumber = positiveInteger(environment.WORKSPACE_E2E_PR_NUMBER);
  const targetSha = fullCommitSha(environment.TARGET_SHA);
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

export const parseE2EExecutionContext = (
  value: string | undefined,
  githubActions: string | undefined,
  githubEventName?: string
): E2EExecutionContext => {
  const normalized = nonEmpty(value);
  if (normalized === "ci" || normalized === "manual") return normalized;
  if (normalized) {
    throw new Error(
      "WORKSPACE_E2E_EXECUTION_CONTEXT must be either 'manual' or 'ci'"
    );
  }
  if (githubActions === "true")
    return githubEventName === "workflow_dispatch" ? "manual" : "ci";
  return "manual";
};

export const toE2EOutcome = <A, E>(exit: Exit.Exit<A, E>): E2EOutcome =>
  Exit.isSuccess(exit)
    ? "passed"
    : Cause.hasInterruptsOnly(exit.cause)
      ? "cancelled"
      : "failed";

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
          outcome: toE2EOutcome(exit),
          phase: "finished",
          scope: "run",
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

const nonEmpty = (value: string | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
};

const positiveInteger = (value: string | undefined) => {
  const normalized = nonEmpty(value);
  if (!normalized) return undefined;
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error("Workspace E2E numeric telemetry context is invalid");
  }
  return number;
};

const fullCommitSha = (value: string | undefined) => {
  const normalized = nonEmpty(value);
  if (!normalized) return undefined;
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error("TARGET_SHA must be a full lowercase Git commit SHA");
  }
  return normalized;
};
