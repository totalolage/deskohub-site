import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Deferred, Effect, Exit, Option, Semaphore } from "effect";
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
  WorkspaceE2ECaseResources,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
} from "./types";

const e2eOutcomeStatus: Record<E2EOutcome, string> = {
  cancelled: "CANCEL",
  failed: "FAIL",
  passed: "PASS",
  timed_out: "TIMEOUT",
};

export const workspaceE2EReservationStartConcurrency = 6;
export const workspaceE2EHostedPaymentConcurrency = 3;
export { workspaceE2EProviderVerificationConcurrency };

type ReservationStartPermit = {
  readonly deferred: Deferred.Deferred<void>;
  granted: boolean;
  readonly priority: number;
  released: boolean;
  readonly sequence: number;
};

interface ReservationStartPermitPool {
  readonly withPermit: <A, E, R>(
    priority: number,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
}

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

export const runWorkspaceE2ECases = ({
  artifactRoot,
  cases,
  datasourceConfig,
  reportFailure,
  run,
  sessionPrefix,
  timeouts,
}: {
  artifactRoot: string;
  cases: readonly WorkspaceE2ECase[];
  datasourceConfig: DatasourceConfig;
  reportFailure?: WorkspaceE2EFailureReporter;
  run: Runner;
  sessionPrefix: string;
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
      const reservationStartPermitPool = yield* makeReservationStartPermitPool(
        workspaceE2EReservationStartConcurrency
      );
      const hostedPaymentSemaphore = yield* Semaphore.make(
        workspaceE2EHostedPaymentConcurrency
      );
      const resources: WorkspaceE2ECaseResources = {
        withHostedPaymentSession: (effect) =>
          hostedPaymentSemaphore.withPermit(effect),
      };
      const providerVerificationPermit =
        yield* WorkspaceE2EProviderVerificationPermitService;
      const indexedCases = [...cases.entries()];
      const independentFailure = yield* Deferred.make<number>();
      const parallelCases = indexedCases
        .filter(([, testCase]) => !testCase.runAfterParallel)
        .sort(([, left], [, right]) => left.timeoutMs - right.timeoutMs);
      const sharedFixtureCases = indexedCases.filter(
        ([, testCase]) => testCase.runAfterParallel
      );
      const runCaseEntry = (
        [caseIndex, testCase]: (typeof indexedCases)[number],
        failureSignal?: Deferred.Deferred<number>
      ) => {
        let caseRuntime: WorkspaceE2ECaseRuntime | undefined;
        const tracedCase = telemetry.traceCase({
          caseId: testCase.id,
          effect: Effect.acquireUseRelease(
            Effect.sync((): WorkspaceE2ECaseRuntime => {
              const runtime: WorkspaceE2ECaseRuntime = {
                artifactDir: resolve(artifactRoot, testCase.id),
                browserHarStarted: false,
                browserHarStopped: false,
                session: `${sessionPrefix}-${caseIndex}`,
                testCase,
              };
              caseRuntime = runtime;
              return runtime;
            }),
            (runtime) => {
              const execution = runCase(
                runtime,
                run,
                telemetry,
                timeouts,
                reservationStartPermitPool,
                providerVerificationPermit,
                resources
              ).pipe(
                Effect.tapCause((cause) =>
                  failureSignal && !Cause.hasInterruptsOnly(cause)
                    ? Deferred.succeed(failureSignal, caseIndex).pipe(
                        Effect.asVoid
                      )
                    : Effect.void
                ),
                Effect.tapCause(() =>
                  runtime.failureCause
                    ? captureFailureArtifacts(runtime, run, timeouts)
                    : Effect.void
                )
              );

              if (!failureSignal) return execution;

              const interruptOnSiblingFailure = Deferred.await(
                failureSignal
              ).pipe(
                Effect.flatMap((failingCaseIndex) =>
                  failingCaseIndex === caseIndex
                    ? Effect.never
                    : Effect.interrupt
                )
              );

              return Effect.raceFirst(execution, interruptOnSiblingFailure);
            },
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

        const diagnosedCase = reportFailure
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

        if (!failureSignal) return diagnosedCase;

        return diagnosedCase.pipe(
          Effect.catchCause((cause) => {
            if (!Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);

            return Deferred.isDone(failureSignal).pipe(
              Effect.flatMap((isDone) =>
                isDone
                  ? Deferred.await(failureSignal).pipe(
                      Effect.flatMap((failingCaseIndex) =>
                        failingCaseIndex === caseIndex
                          ? Effect.failCause(cause)
                          : Effect.void
                      )
                    )
                  : Effect.failCause(cause)
              )
            );
          })
        );
      };

      log(
        `Running ${parallelCases.length} workspace e2e cases in parallel: ${parallelCases
          .map(([, testCase]) => testCase.id)
          .join(", ")}`
      );
      yield* telemetry.tracePhase({
        effect: Effect.forEach(
          parallelCases,
          (entry) => runCaseEntry(entry, independentFailure),
          {
            concurrency: "unbounded",
            discard: true,
          }
        ),
        phaseId: "independent-case-phase",
      });
      if (sharedFixtureCases.length > 0) {
        log(
          `Running ${sharedFixtureCases.length} shared-fixture workspace e2e cases after the parallel phase: ${sharedFixtureCases
            .map(([, testCase]) => testCase.id)
            .join(", ")}`
        );
        yield* telemetry.tracePhase({
          effect: Effect.forEach(
            sharedFixtureCases,
            (entry) => runCaseEntry(entry),
            {
              concurrency: 1,
              discard: true,
            }
          ),
          phaseId: "shared-fixture-phase",
        });
      }
    })
  );

const runCase = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner,
  telemetry: E2ETelemetry,
  timeouts: WorkspaceE2ETimeouts,
  reservationStartPermitPool: ReservationStartPermitPool,
  providerVerificationPermit: WorkspaceE2EProviderVerificationPermit,
  resources: WorkspaceE2ECaseResources
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> => {
  const startedAt = Date.now();
  const runStep = makeStepRunner(
    runtime,
    telemetry,
    reservationStartPermitPool,
    providerVerificationPermit,
    runtime.testCase.timeoutMs
  );

  return Effect.gen(function* () {
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
      resources,
      runStep,
      session: runtime.session,
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${runtime.testCase.timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          workspaceE2ETimeoutError(
            `Timed out running ${runtime.testCase.id} e2e case after ${formatWorkspaceE2EDuration(runtime.testCase.timeoutMs)}`,
            { operation: `${runtime.testCase.id} e2e case` }
          )
        ),
    }),
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
    reservationStartPermitPool: ReservationStartPermitPool,
    providerVerificationPermit: WorkspaceE2EProviderVerificationPermit,
    caseTimeoutMs: number
  ): WorkspaceE2EStepRunner =>
  <A, R>({ capacity, execute, id, timeoutMs }: WorkspaceE2EStep<A, R>) => {
    const caseId = runtime.testCase.id;
    const operation = `${caseId}/${id}`;
    const timedExecution = execute.pipe(
      Effect.timeoutOrElse({
        duration: `${timeoutMs} millis`,
        orElse: () =>
          Effect.fail(
            workspaceE2ETimeoutError(
              `Timed out running ${operation} after ${formatWorkspaceE2EDuration(timeoutMs)}`,
              { operation }
            )
          ),
      })
    );
    const capacityLimitedExecution = (() => {
      if (capacity === "reservation-start") {
        return reservationStartPermitPool.withPermit(
          caseTimeoutMs,
          timedExecution
        );
      }
      if (capacity === "provider-verification") {
        return providerVerificationPermit.withPermit(timedExecution);
      }
      return timedExecution;
    })();

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

export const makeReservationStartPermitPool = (
  capacity: number
): Effect.Effect<ReservationStartPermitPool> =>
  Effect.sync(() => {
    let activePermits = 0;
    let nextSequence = 0;
    const waiters: ReservationStartPermit[] = [];

    const releaseSlot = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        const next = yield* Effect.sync(() => {
          if (waiters.length === 0) {
            activePermits -= 1;
            return undefined;
          }

          let nextIndex = 0;
          for (let index = 1; index < waiters.length; index += 1) {
            const candidate = waiters[index]!;
            const selected = waiters[nextIndex]!;
            if (
              candidate.priority < selected.priority ||
              (candidate.priority === selected.priority &&
                candidate.sequence < selected.sequence)
            ) {
              nextIndex = index;
            }
          }

          const [selected] = waiters.splice(nextIndex, 1);
          selected!.granted = true;
          return selected;
        });

        if (next) yield* Deferred.succeed(next.deferred, undefined);
      });

    const releasePermit = (
      permit: ReservationStartPermit
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const granted = yield* Effect.sync(() => {
          if (permit.released) return false;
          permit.released = true;
          if (permit.granted) return true;

          const index = waiters.indexOf(permit);
          if (index >= 0) waiters.splice(index, 1);
          return false;
        });

        if (granted) yield* releaseSlot();
      });

    const acquirePermit = (
      priority: number
    ): Effect.Effect<ReservationStartPermit> =>
      Effect.gen(function* () {
        const deferred = yield* Deferred.make<void>();
        const permit: ReservationStartPermit = {
          deferred,
          granted: false,
          priority,
          released: false,
          sequence: nextSequence,
        };
        nextSequence += 1;
        const granted = yield* Effect.sync(() => {
          if (activePermits < capacity) {
            activePermits += 1;
            permit.granted = true;
            return true;
          }

          waiters.push(permit);
          return false;
        });

        if (!granted) {
          yield* Deferred.await(deferred).pipe(
            Effect.onInterrupt(() => releasePermit(permit))
          );
        }
        return permit;
      });

    return {
      withPermit: (priority, effect) =>
        Effect.uninterruptibleMask((restore) =>
          restore(acquirePermit(priority)).pipe(
            Effect.flatMap((permit) =>
              restore(effect).pipe(Effect.ensuring(releasePermit(permit)))
            )
          )
        ),
    };
  });

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
    yield* collectFinalizerFailure(
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
