import { devNull } from "node:os";
import { resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import {
  captureBrowserFailureArtifacts,
  closeBrowserSession,
  startBrowserDiagnostics,
  stopBrowserHar,
} from "./browser";
import { runE2ECase, type WorkspaceE2EStepRunner } from "./case-runner";
import type { DatasourceConfig } from "./config";
import type { WorkspaceE2EHostedPaymentPermitService } from "./coordination/hosted-payment-permit.service";
import type { WorkspaceE2EProviderVerificationPermitService } from "./coordination/provider-verification-permit.service";
import { type WorkspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import type { E2EDatabase } from "./integrations/database.service";
import type { Runner } from "./runtime";
import { log, redact } from "./runtime";
import {
  type WorkspaceE2ECleanup,
  WorkspaceE2ECleanupService,
} from "./services/cleanup";
import type {
  E2ETelemetryService,
  WorkspaceE2EFailureDiagnostic,
} from "./services/telemetry";
import type { WorkspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

export type WorkspaceE2EFailureReporter = (
  diagnostic: WorkspaceE2EFailureDiagnostic
) => void;

/** The case's browser session, shared by its body, failure capture, and cleanup. */
type WorkspaceE2ECaseBrowser = {
  readonly artifactDir: string;
  failureCause?: Cause.Cause<WorkspaceE2EError>;
  harStarted: boolean;
  harStopped: boolean;
  readonly session: string;
  readonly testCase: WorkspaceE2ECase;
};

/**
 * Runs one checkout case on the case runner. The body starts browser
 * diagnostics in the case's own session before the case steps; a genuine
 * failure captures browser artifacts while the session is still open; cleanup
 * cancels the case's owned reservations while it stops HAR and closes the
 * session.
 */
export const runWorkspaceE2ECase = ({
  artifactRoot,
  datasourceConfig,
  run,
  sessionPrefix,
  testCase,
  timeouts,
}: {
  artifactRoot: string;
  datasourceConfig: DatasourceConfig;
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
  | WorkspaceE2EHostedPaymentPermitService
  | WorkspaceE2EProviderVerificationPermitService
> =>
  Effect.gen(function* () {
    const cleanup = yield* WorkspaceE2ECleanupService;
    const browser: WorkspaceE2ECaseBrowser = {
      artifactDir: resolve(artifactRoot, testCase.id),
      harStarted: false,
      harStopped: false,
      session: `${sessionPrefix}-${testCase.id}`,
      testCase,
    };

    yield* runE2ECase({
      body: Effect.fn(function* (step: WorkspaceE2EStepRunner) {
        browser.harStarted = yield* startBrowserDiagnostics(
          run,
          browser.session
        ).pipe(
          Effect.timeoutOrElse({
            duration: `${timeouts.browserAction} millis`,
            orElse: () =>
              Effect.fail(
                workspaceE2ETimeoutError(
                  `Timed out starting browser diagnostics for ${testCase.id}`,
                  { operation: `${testCase.id} browser diagnostics` }
                )
              ),
          })
        );
        yield* testCase.execute({ runStep: step, session: browser.session });
      }),
      caseId: testCase.id,
      cleanup: finalizeCaseBrowser(
        browser,
        run,
        timeouts,
        cleanup,
        datasourceConfig
      ),
      onFailure: (cause) =>
        Effect.suspend(() => {
          browser.failureCause = cause;
          return captureFailureArtifacts(browser, cause, run, timeouts);
        }),
      watchdogMs: testCase.timeoutMs,
    });
  });

const captureFailureArtifacts = (
  browser: WorkspaceE2ECaseBrowser,
  failureCause: Cause.Cause<WorkspaceE2EError>,
  run: Runner,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, never> =>
  captureBrowserFailureArtifacts({
    artifactDir: browser.artifactDir,
    cause: Cause.squash(failureCause),
    harStarted: browser.harStarted,
    run,
    session: browser.session,
  }).pipe(
    Effect.timeoutOrElse({
      duration: `${timeouts.artifactCapture} millis`,
      orElse: () =>
        Effect.sync(() => {
          log(`Browser artifact capture timed out for ${browser.testCase.id}`);
          return false;
        }),
    }),
    Effect.tap((harStopped) =>
      Effect.sync(() => {
        browser.harStopped = harStopped;
      })
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() =>
        logAuxiliaryFailure(
          `${browser.testCase.id} browser artifact capture`,
          cause
        )
      )
    ),
    Effect.asVoid
  );

const finalizeCaseBrowser = (
  browser: WorkspaceE2ECaseBrowser,
  run: Runner,
  timeouts: WorkspaceE2ETimeouts,
  cleanup: WorkspaceE2ECleanup,
  datasourceConfig: DatasourceConfig
): Effect.Effect<void, never, E2EDatabase> =>
  Effect.gen(function* () {
    const failures: unknown[] = [];
    const reservationCleanup = collectFinalizerFailure(
      failures,
      `${browser.testCase.id} reservation cleanup`,
      runFinalizer(
        `${browser.testCase.id} reservation cleanup`,
        cleanup
          .cleanupOwnedCheckoutStates({
            datasourceConfig,
            flowStates: browser.testCase.checkoutStates,
            workflowError: browser.failureCause
              ? Cause.squash(browser.failureCause)
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
      if (browser.harStarted && !browser.harStopped) {
        yield* collectFinalizerFailure(
          failures,
          `${browser.testCase.id} HAR stop`,
          runFinalizer(
            `${browser.testCase.id} HAR stop`,
            stopBrowserHar(run, browser.session, devNull),
            timeouts
          )
        );
      }
      yield* collectFinalizerFailure(
        failures,
        `${browser.testCase.id} browser close`,
        runFinalizer(
          `${browser.testCase.id} browser close`,
          closeBrowserSession(run, browser.session),
          timeouts
        )
      );
    });
    yield* Effect.all([reservationCleanup, browserFinalization], {
      concurrency: "unbounded",
      discard: true,
    });

    if (failures.length > 0)
      return yield* Effect.die(
        new AggregateError(
          failures,
          `Failed to finalize ${browser.testCase.id} e2e case`
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
