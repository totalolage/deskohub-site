import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  captureBrowserFailureArtifacts,
  closeBrowserSession,
  startBrowserDiagnostics,
  stopBrowserHar,
} from "./browser";
import { type WorkspaceE2EError, workspaceE2EError } from "./errors";
import type { Runner } from "./runtime";
import { log, redact } from "./runtime";
import {
  formatWorkspaceE2EDuration,
  getWorkspaceE2ETimeoutMs,
} from "./timeouts";
import type {
  WorkspaceE2ECase,
  WorkspaceE2EStep,
  WorkspaceE2EStepRunner,
} from "./types";

type WorkspaceE2ECaseRuntime = {
  readonly artifactDir: string;
  browserHarStarted: boolean;
  browserHarStopped: boolean;
  failureCause?: Cause.Cause<WorkspaceE2EError>;
  readonly session: string;
  readonly testCase: WorkspaceE2ECase;
};

export const runWorkspaceE2ECases = ({
  artifactRoot,
  cases,
  run,
  sessionPrefix,
}: {
  artifactRoot: string;
  cases: readonly WorkspaceE2ECase[];
  run: Runner;
  sessionPrefix: string;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.scoped(
    Effect.gen(function* () {
      log(
        `Running ${cases.length} workspace e2e cases in parallel: ${cases
          .map((testCase) => testCase.id)
          .join(", ")}`
      );
      const runtimes = yield* Effect.forEach(cases, (testCase) =>
        Effect.acquireRelease(
          Effect.sync(
            (): WorkspaceE2ECaseRuntime => ({
              artifactDir: resolve(artifactRoot, testCase.id),
              browserHarStarted: false,
              browserHarStopped: false,
              session: `${sessionPrefix}-${testCase.id}`,
              testCase,
            })
          ),
          (runtime) => finalizeCaseRuntime(runtime, run)
        )
      );

      yield* Effect.forEach(runtimes, (runtime) =>
        runCase(runtime, run).pipe(Effect.forkChild)
      ).pipe(
        Effect.andThen(Fiber.joinAll),
        Effect.tapCause(() =>
          Effect.forEach(
            runtimes.filter((runtime) => runtime.failureCause !== undefined),
            (runtime) => captureFailureArtifacts(runtime, run),
            { discard: true }
          )
        )
      );
    })
  );

const runCase = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner
): Effect.Effect<void, WorkspaceE2EError> => {
  const startedAt = Date.now();
  const runStep = makeStepRunner(runtime.testCase.id);

  return Effect.gen(function* () {
    log(`CASE START ${runtime.testCase.id}`);
    runtime.browserHarStarted = yield* startBrowserDiagnostics(
      run,
      runtime.session
    ).pipe(
      Effect.timeoutOrElse({
        duration: `${getWorkspaceE2ETimeoutMs("browserAction")} millis`,
        orElse: () =>
          Effect.fail(
            workspaceE2EError(
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
          workspaceE2EError(
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
        const elapsed = formatWorkspaceE2EDuration(Date.now() - startedAt);
        const status = Exit.isSuccess(exit)
          ? "PASS"
          : Cause.hasInterruptsOnly(exit.cause)
            ? "CANCEL"
            : "FAIL";
        log(`CASE ${status} ${runtime.testCase.id} (${elapsed})`);
      })
    )
  );
};

const makeStepRunner =
  (caseId: string): WorkspaceE2EStepRunner =>
  <A>({ execute, id, timeoutMs }: WorkspaceE2EStep<A>) => {
    const startedAt = Date.now();
    const operation = `${caseId}/${id}`;

    return Effect.sync(() => log(`STEP START ${operation}`)).pipe(
      Effect.andThen(
        execute.pipe(
          Effect.timeoutOrElse({
            duration: `${timeoutMs} millis`,
            orElse: () =>
              Effect.fail(
                workspaceE2EError(
                  `Timed out running ${operation} after ${formatWorkspaceE2EDuration(timeoutMs)}`,
                  { operation }
                )
              ),
          })
        )
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const elapsed = formatWorkspaceE2EDuration(Date.now() - startedAt);
          const status = Exit.isSuccess(exit)
            ? "PASS"
            : Cause.hasInterruptsOnly(exit.cause)
              ? "CANCEL"
              : "FAIL";
          log(`STEP ${status} ${operation} (${elapsed})`);
        })
      )
    );
  };

const captureFailureArtifacts = (
  runtime: WorkspaceE2ECaseRuntime,
  run: Runner
): Effect.Effect<void, never> =>
  captureBrowserFailureArtifacts({
    artifactDir: runtime.artifactDir,
    cause: Cause.squash(runtime.failureCause!),
    harStarted: runtime.browserHarStarted,
    run,
    session: runtime.session,
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${getWorkspaceE2ETimeoutMs("artifactCapture")} millis`,
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
  run: Runner
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const failures: unknown[] = [];
    if (runtime.browserHarStarted && !runtime.browserHarStopped) {
      yield* collectFinalizerFailure(
        failures,
        `${runtime.testCase.id} HAR stop`,
        runFinalizer(
          `${runtime.testCase.id} HAR stop`,
          stopBrowserHar(run, runtime.session, devNull)
        )
      );
    }
    yield* collectFinalizerFailure(
      failures,
      `${runtime.testCase.id} browser close`,
      runFinalizer(
        `${runtime.testCase.id} browser close`,
        closeBrowserSession(run, runtime.session)
      )
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
  effect: Effect.Effect<A, WorkspaceE2EError>
): Effect.Effect<void, WorkspaceE2EError> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: `${getWorkspaceE2ETimeoutMs("cleanupAction")} millis`,
      orElse: () =>
        Effect.fail(
          workspaceE2EError(`Timed out running ${operation}`, { operation })
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
