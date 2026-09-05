import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import {
  captureBrowserFailureArtifacts,
  closeBrowserSession,
  startBrowserDiagnostics,
  stopBrowserHar,
} from "./browser";
import type { DatasourceConfig } from "./config";
import {
  type WorkspaceE2EProviderVerificationPermit,
  WorkspaceE2EProviderVerificationPermitService,
  workspaceE2EProviderVerificationConcurrency,
} from "./coordination/provider-verification-permit.service";
import {
  type WorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";
import type { E2EDatabase } from "./integrations/database.service";
import { pollUntil, withinWorkspaceE2EDeadline } from "./polling";
import type { Runner } from "./runtime";
import { log, redact } from "./runtime";
import {
  type WorkspaceE2ECleanup,
  WorkspaceE2ECleanupService,
} from "./services/cleanup";
import {
  type E2EFailureKind,
  type E2EOutcome,
  type E2EResult,
  type E2ETelemetry,
  E2ETelemetryService,
  toE2EResult,
} from "./services/telemetry";
import {
  formatWorkspaceE2EDuration,
  type WorkspaceE2ETimeouts,
} from "./timeouts";
import type {
  WorkspaceE2ECase,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
} from "./types";

const e2eOutcomeStatus: Record<E2EOutcome, string> = {
  cancelled: "CANCEL",
  failed: "FAIL",
  passed: "PASS",
  timed_out: "TIMEOUT",
};

export { workspaceE2EProviderVerificationConcurrency };

export type WorkspaceE2EFailureDiagnostic = {
  readonly caseId: string;
  readonly diagnosticCode?: WorkspaceE2EDiagnosticCode;
  readonly failureKind: E2EFailureKind;
  readonly outcome: "failed" | "timed_out";
  readonly stepId?: string;
};

export type WorkspaceE2EFailureReporter = (
  diagnostic: WorkspaceE2EFailureDiagnostic
) => void;

type WorkspaceE2ECaseRuntime = {
  readonly artifactDir: string;
  browserHarStarted: boolean;
  browserHarStopped: boolean;
  durationMs?: number;
  failureCause?: Cause.Cause<WorkspaceE2EError>;
  result?: E2EResult;
  readonly session: string;
  terminalStepId?: string;
  readonly testCase: WorkspaceE2ECase;
};

export const runWorkspaceE2ECase = ({
  artifactRoot,
  datasourceConfig,
  reportFailure,
  run,
  sessionPrefix,
  testCase,
  timeouts,
}: {
  artifactRoot: string;
  datasourceConfig: DatasourceConfig;
  reportFailure?: WorkspaceE2EFailureReporter;
  run: Runner;
  sessionPrefix: string;
  testCase: WorkspaceE2ECase;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<
  void,
  WorkspaceE2EError,
  | E2EDatabase
  | E2ETelemetryService
  | WorkspaceE2ECleanupService
  | WorkspaceE2EProviderVerificationPermitService
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      const cleanup = yield* WorkspaceE2ECleanupService;
      const providerVerificationPermit =
        yield* WorkspaceE2EProviderVerificationPermitService;
      let caseRuntime: WorkspaceE2ECaseRuntime | undefined;
      const tracedCase = telemetry.traceCase({
        caseId: testCase.id,
        effect: Effect.acquireUseRelease(
          Effect.sync((): WorkspaceE2ECaseRuntime => {
            const runtime: WorkspaceE2ECaseRuntime = {
              artifactDir: resolve(artifactRoot, testCase.id),
              browserHarStarted: false,
              browserHarStopped: false,
              session: `${sessionPrefix}-${testCase.id}`,
              testCase,
            };
            caseRuntime = runtime;
            return runtime;
          }),
          (runtime) =>
            runCase(
              runtime,
              run,
              telemetry,
              timeouts,
              providerVerificationPermit
            ).pipe(
              Effect.tapCause(() =>
                runtime.failureCause
                  ? captureFailureArtifacts(runtime, run, timeouts)
                  : Effect.void
              )
            ),
          (runtime) =>
            telemetry.tracePhase({
              caseId: testCase.id,
              effect: finalizeCaseRuntime(
                runtime,
                run,
                timeouts,
                cleanup,
                datasourceConfig
              ),
              phaseId: "case-finalization",
            })
        ),
        timeoutMs: testCase.timeoutMs,
      });

      yield* reportFailure
        ? tracedCase.pipe(
            Effect.tapCause((cause) =>
              Effect.sync(() => {
                if (Cause.hasInterruptsOnly(cause)) return;
                const result = toE2EResult(Exit.failCause(cause));
                if (
                  result.outcome !== "failed" &&
                  result.outcome !== "timed_out"
                )
                  return;
                const error = Cause.findErrorOption(cause);
                const diagnosticCode =
                  Option.isSome(error) &&
                  error.value instanceof WorkspaceE2EError
                    ? error.value.diagnosticCode
                    : undefined;
                try {
                  reportFailure({
                    caseId: testCase.id,
                    ...(diagnosticCode ? { diagnosticCode } : {}),
                    failureKind: result.failureKind,
                    outcome: result.outcome,
                    ...(caseRuntime?.terminalStepId
                      ? { stepId: caseRuntime.terminalStepId }
                      : {}),
                  });
                } catch {
                  log("Workspace E2E failure reporter failed");
                }
              })
            )
          )
        : tracedCase;
    })
  );

const runCase = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner,
  telemetry: E2ETelemetry,
  timeouts: WorkspaceE2ETimeouts,
  providerVerificationPermit: WorkspaceE2EProviderVerificationPermit
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> => {
  const startedAt = Date.now();
  const runStep = makeStepRunner(
    runtime,
    telemetry,
    providerVerificationPermit
  );

  return withinWorkspaceE2EDeadline(
    Effect.gen(function* () {
      log(`CASE START ${runtime.testCase.id}`);
      runtime.browserHarStarted = yield* startBrowserDiagnostics(
        run,
        runtime.session
      ).pipe(
        Effect.timeoutOrElse({
          duration: `${timeouts.browserAction} millis`,
          orElse: () =>
            Effect.fail(
              workspaceE2ETimeoutError(
                `Timed out starting browser diagnostics for ${runtime.testCase.id}`,
                { operation: `${runtime.testCase.id} browser diagnostics` }
              )
            ),
        })
      );
      yield* runtime.testCase.execute({
        runStep,
        session: runtime.session,
      });
    }),
    `${runtime.testCase.id} e2e case`,
    runtime.testCase.timeoutMs
  ).pipe(
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        if (!Cause.hasInterruptsOnly(cause)) runtime.failureCause = cause;
      })
    ),
    Effect.onExit((exit) =>
      Effect.sync(() => {
        runtime.durationMs = Date.now() - startedAt;
        runtime.result = toE2EResult(exit);
      })
    )
  );
};

const makeStepRunner =
  (
    runtime: WorkspaceE2ECaseRuntime,
    telemetry: E2ETelemetry,
    providerVerificationPermit: WorkspaceE2EProviderVerificationPermit
  ): WorkspaceE2EStepRunner =>
  <A, R>({ capacity, execute, id, timeoutMs }: WorkspaceE2EStep<A, R>) => {
    const caseId = runtime.testCase.id;
    const operation = `${caseId}/${id}`;
    const timedExecution = withinWorkspaceE2EDeadline(
      execute,
      operation,
      timeoutMs
    );
    const capacityLimitedExecution =
      capacity === "provider-verification"
        ? providerVerificationPermit.withPermit(timedExecution)
        : timedExecution;

    return telemetry.traceStep({
      caseId,
      effect: Effect.suspend(() => {
        const startedAt = Date.now();

        return Effect.sync(() => log(`STEP START ${operation}`)).pipe(
          Effect.andThen(capacityLimitedExecution),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              const durationMs = Date.now() - startedAt;
              const elapsed = formatWorkspaceE2EDuration(durationMs);
              const { outcome } = toE2EResult(exit);
              if (outcome !== "passed") runtime.terminalStepId = id;
              const status = e2eOutcomeStatus[outcome];
              log(`STEP ${status} ${operation} (${elapsed})`);
            })
          )
        );
      }),
      stepId: id,
      timeoutMs,
    });
  };

const captureFailureArtifacts = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, never> =>
  captureBrowserFailureArtifacts({
    artifactDir: runtime.artifactDir,
    cause: Cause.squash(runtime.failureCause!),
    harStarted: runtime.browserHarStarted,
    run,
    session: runtime.session,
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${timeouts.artifactCapture} millis`,
      orElse: () =>
        Effect.sync(() => {
          log(`Browser artifact capture timed out for ${runtime.testCase.id}`);
          return false;
        }),
    }),
    Effect.tap((harStopped) =>
      Effect.sync(() => {
        runtime.browserHarStopped = harStopped;
      })
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() =>
        logAuxiliaryFailure(
          `${runtime.testCase.id} browser artifact capture`,
          cause
        )
      )
    ),
    Effect.asVoid
  );

const finalizeCaseRuntime = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner,
  timeouts: WorkspaceE2ETimeouts,
  cleanup: WorkspaceE2ECleanup,
  datasourceConfig: DatasourceConfig
): Effect.Effect<void, never, E2EDatabase> =>
  Effect.gen(function* () {
    const failures: unknown[] = [];
    const reservationCleanup = collectFinalizerFailure(
      failures,
      `${runtime.testCase.id} reservation cleanup`,
      runFinalizer(
        `${runtime.testCase.id} reservation cleanup`,
        cleanup
          .cleanupOwnedCheckoutStates({
            datasourceConfig,
            flowStates: runtime.testCase.checkoutStates,
            workflowError: runtime.failureCause
              ? Cause.squash(runtime.failureCause)
              : undefined,
          })
          .pipe(
            Effect.flatMap((cleanupError) =>
              cleanupError ? Effect.fail(cleanupError) : Effect.void
            )
          ),
        timeouts
      )
    );
    const browserFinalization = Effect.gen(function* () {
      if (runtime.browserHarStarted && !runtime.browserHarStopped) {
        yield* collectFinalizerFailure(
          failures,
          `${runtime.testCase.id} HAR stop`,
          runFinalizer(
            `${runtime.testCase.id} HAR stop`,
            stopBrowserHar(run, runtime.session, devNull),
            timeouts
          )
        );
      }
      yield* collectFinalizerFailure(
        failures,
        `${runtime.testCase.id} browser close`,
        runFinalizer(
          `${runtime.testCase.id} browser close`,
          closeBrowserSession(run, runtime.session),
          timeouts
        )
      );
    });
    yield* Effect.all([reservationCleanup, browserFinalization], {
      concurrency: "unbounded",
      discard: true,
    });

    const durationMs = runtime.durationMs ?? 0;
    const result: E2EResult =
      failures.length > 0
        ? { failureKind: "error", outcome: "failed" }
        : (runtime.result ?? { outcome: "cancelled" });
    const { outcome } = result;
    const status = e2eOutcomeStatus[outcome];
    log(
      `CASE ${status} ${runtime.testCase.id} (${formatWorkspaceE2EDuration(durationMs)})`
    );

    if (failures.length > 0)
      return yield* Effect.die(
        new AggregateError(
          failures,
          `Failed to finalize ${runtime.testCase.id} e2e case`
        )
      );
  });

const runFinalizer = <A, R>(
  operation: string,
  effect: Effect.Effect<A, WorkspaceE2EError, R>,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, WorkspaceE2EError, R> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: `${timeouts.cleanupAction} millis`,
      orElse: () =>
        Effect.fail(
          workspaceE2ETimeoutError(`Timed out running ${operation}`, {
            operation,
          })
        ),
    }),
    Effect.asVoid
  );

const collectFinalizerFailure = <R>(
  failures: unknown[],
  operation: string,
  effect: Effect.Effect<void, WorkspaceE2EError, R>
): Effect.Effect<void, never, R> =>
  Effect.exit(effect).pipe(
    Effect.tap((exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) return;
        logAuxiliaryFailure(operation, exit.cause);
        failures.push(Cause.squash(exit.cause));
      })
    ),
    Effect.asVoid
  );

const logAuxiliaryFailure = (operation: string, cause: Cause.Cause<unknown>) =>
  log(`${operation} failed: ${redact(String(Cause.squash(cause)))}`);
