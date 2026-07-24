import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  captureBrowserFailureArtifacts,
  closeBrowserSession,
  startBrowserDiagnostics,
  stopBrowserHar,
} from "./browser";
import { type WorkspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import type { Runner } from "./runtime";
import { log, redact } from "./runtime";
import {
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

type WorkspaceE2ECaseRuntime = {
  readonly artifactDir: string;
  browserHarStarted: boolean;
  browserHarStopped: boolean;
  durationMs?: number;
  failureCause?: Cause.Cause<WorkspaceE2EError>;
  result?: E2EResult;
  readonly session: string;
  readonly testCase: WorkspaceE2ECase;
};

export const runWorkspaceE2ECases = ({
  artifactRoot,
  cases,
  run,
  sessionPrefix,
  timeouts,
}: {
  artifactRoot: string;
  cases: readonly WorkspaceE2ECase[];
  run: Runner;
  sessionPrefix: string;
  timeouts: WorkspaceE2ETimeouts;
}): Effect.Effect<void, WorkspaceE2EError, E2ETelemetryService> =>
  Effect.scoped(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      log(
        `Running ${cases.length} workspace e2e cases in parallel: ${cases
          .map((testCase) => testCase.id)
          .join(", ")}`
      );
      yield* Effect.forEach(cases, (testCase) =>
        telemetry
          .traceCase({
            caseId: testCase.id,
            effect: Effect.acquireUseRelease(
              Effect.sync(
                (): WorkspaceE2ECaseRuntime => ({
                  artifactDir: resolve(artifactRoot, testCase.id),
                  browserHarStarted: false,
                  browserHarStopped: false,
                  session: `${sessionPrefix}-${testCase.id}`,
                  testCase,
                })
              ),
              (runtime) =>
                runCase(runtime, run, telemetry, timeouts).pipe(
                  Effect.tapCause(() =>
                    runtime.failureCause
                      ? captureFailureArtifacts(runtime, run, timeouts)
                      : Effect.void
                  )
                ),
              (runtime) => finalizeCaseRuntime(runtime, run, timeouts)
            ),
            timeoutMs: testCase.timeoutMs,
          })
          .pipe(Effect.forkChild)
      ).pipe(Effect.andThen(Fiber.joinAll));
    })
  );

const runCase = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner,
  telemetry: E2ETelemetry,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, WorkspaceE2EError> => {
  const startedAt = Date.now();
  const runStep = makeStepRunner(runtime.testCase.id, telemetry);

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
    yield* runtime.testCase.execute({ runStep, session: runtime.session });
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
  (caseId: string, telemetry: E2ETelemetry): WorkspaceE2EStepRunner =>
  <A>({ execute, id, timeoutMs }: WorkspaceE2EStep<A>) => {
    const startedAt = Date.now();
    const operation = `${caseId}/${id}`;

    return telemetry.traceStep({
      caseId,
      effect: Effect.sync(() => log(`STEP START ${operation}`)).pipe(
        Effect.andThen(
          execute.pipe(
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
          )
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            const durationMs = Date.now() - startedAt;
            const elapsed = formatWorkspaceE2EDuration(durationMs);
            const { outcome } = toE2EResult(exit);
            const status = e2eOutcomeStatus[outcome];
            log(`STEP ${status} ${operation} (${elapsed})`);
          })
        )
      ),
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
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const failures: unknown[] = [];
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

const runFinalizer = <A>(
  operation: string,
  effect: Effect.Effect<A, WorkspaceE2EError>,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, WorkspaceE2EError> =>
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

const collectFinalizerFailure = (
  failures: unknown[],
  operation: string,
  effect: Effect.Effect<void, WorkspaceE2EError>
) =>
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
