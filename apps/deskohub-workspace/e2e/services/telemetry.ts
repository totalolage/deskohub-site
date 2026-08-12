import { randomUUID } from "node:crypto";
import { Cause, Context, Effect, Exit, Layer, Option, Schema } from "effect";
import {
  makeWorkspaceE2EDateAllocation,
  type WorkspaceE2EDateAllocation,
} from "../allocation";
import type { E2EEnvironment } from "../e2e-env";
import { isWorkspaceE2ETimeout, WorkspaceE2EError } from "../errors";
import {
  type GitHubActionsRunId,
  githubActionsRunIdSchema,
  type WorkspaceE2ERunId,
  workspaceE2ERunIdSchema,
} from "../run-identifiers";
import { log } from "../runtime";
import { formatWorkspaceE2EDuration } from "../timeouts";

export type E2EExecutionContext = "ci" | "manual";
export type E2EOutcome = "cancelled" | "failed" | "passed" | "timed_out";
export type E2EFailureKind = "defect" | "error" | "timeout";
export type E2EPhaseId =
  | "case-construction"
  | "case-finalization"
  | "cowork-availability-preparation"
  | "fixture-seeding"
  | "invoice-persistence"
  | "meeting-room-availability-preparation"
  | "office-availability-preparation"
  | "preview-readiness"
  | "provider-preparation"
  | "suite-cleanup";

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

export type E2ERunContext = {
  readonly allocation: WorkspaceE2EDateAllocation;
  readonly executionContext: E2EExecutionContext;
  readonly githubRunAttempt?: number;
  readonly githubRunId?: GitHubActionsRunId;
  readonly prNumber?: number;
  readonly runId: WorkspaceE2ERunId;
  readonly targetSha?: string;
};

export type E2ESpan =
  | {
      readonly scope: "run";
    }
  | {
      readonly caseId: string;
      readonly scope: "case";
      readonly timeoutMs: number;
    }
  | {
      readonly caseId?: string;
      readonly phaseId: E2EPhaseId;
      readonly scope: "phase";
    }
  | {
      readonly caseId: string;
      readonly scope: "step";
      readonly stepId: string;
      readonly timeoutMs: number;
    };

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

  static layerValue = (value: E2ERunContext) => Layer.succeed(this, { value });
}

export interface E2ETelemetry {
  readonly traceCase: <A, E, R>(input: {
    readonly caseId: string;
    readonly effect: Effect.Effect<A, E, R>;
    readonly timeoutMs: number;
  }) => Effect.Effect<A, E, R>;
  readonly traceRun: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  readonly tracePhase: <A, E, R>(input: {
    readonly caseId?: string;
    readonly effect: Effect.Effect<A, E, R>;
    readonly phaseId: E2EPhaseId;
  }) => Effect.Effect<A, E, R>;
  readonly traceStep: <A, E, R>(input: {
    readonly caseId: string;
    readonly effect: Effect.Effect<A, E, R>;
    readonly stepId: string;
    readonly timeoutMs: number;
  }) => Effect.Effect<A, E, R>;
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
        traceCase: ({ caseId, effect, timeoutMs }) =>
          traceE2EEffect(runContext, { caseId, scope: "case", timeoutMs })(
            effect
          ),
        tracePhase: ({ caseId, effect, phaseId }) =>
          traceE2EPhase(runContext, {
            ...(caseId ? { caseId } : {}),
            phaseId,
            scope: "phase",
          })(effect),
        traceRun: traceE2EEffect(runContext, { scope: "run" }),
        traceStep: ({ caseId, effect, stepId, timeoutMs }) =>
          traceE2EEffect(runContext, {
            caseId,
            scope: "step",
            stepId,
            timeoutMs,
          })(effect),
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
  const githubRunId = environment.GITHUB_RUN_ID
    ? Schema.decodeUnknownSync(githubActionsRunIdSchema)(
        environment.GITHUB_RUN_ID
      )
    : undefined;
  const githubRunAttempt = environment.GITHUB_RUN_ATTEMPT;
  const prNumber = environment.WORKSPACE_E2E_PR_NUMBER;
  const targetSha = environment.TARGET_SHA;
  const runId = Schema.decodeUnknownSync(workspaceE2ERunIdSchema)(
    githubRunId && githubRunAttempt
      ? `${githubRunId}-${githubRunAttempt}`
      : `manual-${makeManualRunId()}`
  );

  return {
    allocation: makeWorkspaceE2EDateAllocation({
      prNumber,
      runId,
      ...(environment.WORKSPACE_E2E_ALLOCATION_SHARD
        ? { shardIndex: environment.WORKSPACE_E2E_ALLOCATION_SHARD - 1 }
        : {}),
    }),
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

export const toE2ESpanAttributes = (
  runContext: E2ERunContext,
  span: E2ESpan
): Record<string, boolean | number | string> => ({
  "e2e.execution_context": runContext.executionContext,
  "e2e.allocation.shard": runContext.allocation.shardIndex + 1,
  "e2e.allocation.shards": runContext.allocation.shardCount,
  "e2e.run.id": runContext.runId,
  "e2e.scope": span.scope,
  ...("timeoutMs" in span ? { "e2e.timeout_ms": span.timeoutMs } : {}),
  ...("caseId" in span ? { "e2e.case.id": span.caseId } : {}),
  ...("stepId" in span ? { "e2e.step.id": span.stepId } : {}),
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
  ...("phaseId" in span ? { "e2e.phase.id": span.phaseId } : {}),
});

const traceE2EPhase =
  (runContext: E2ERunContext, span: Extract<E2ESpan, { scope: "phase" }>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const startedAt = Date.now();

    return traceE2EEffect(
      runContext,
      span
    )(effect).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const duration = formatWorkspaceE2EDuration(Date.now() - startedAt);
          const status = toE2EResult(exit).outcome.toUpperCase();
          log(`PHASE ${status} ${span.phaseId} (${duration})`);
        })
      )
    );
  };

const traceE2EEffect =
  (runContext: E2ERunContext, span: E2ESpan) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.onExit((exit) =>
        Effect.annotateCurrentSpan(toE2ETerminalSpanAttributes(exit))
      ),
      Effect.withSpan(
        `e2e.${span.scope}`,
        {
          attributes: toE2ESpanAttributes(runContext, span),
          ...(span.scope === "run" ? { root: true } : {}),
        },
        {
          captureStackTrace: false,
        }
      )
    );

const toE2ETerminalSpanAttributes = <A, E>(
  exit: Exit.Exit<A, E>
): Record<string, string> => {
  const result = toE2EResult(exit);
  const error = Exit.isFailure(exit)
    ? Cause.findErrorOption(exit.cause)
    : Option.none();
  const diagnosticCode =
    Option.isSome(error) && error.value instanceof WorkspaceE2EError
      ? error.value.diagnosticCode
      : undefined;

  return {
    ...(diagnosticCode ? { "e2e.failure.code": diagnosticCode } : {}),
    ...(result.outcome === "failed" || result.outcome === "timed_out"
      ? { "e2e.failure.kind": result.failureKind }
      : {}),
    "e2e.outcome": result.outcome,
  };
};
