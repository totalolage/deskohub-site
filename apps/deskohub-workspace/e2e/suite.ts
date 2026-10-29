import { resolve } from "node:path";
import { Cause, Effect, Exit } from "effect";
import { readBrowserPageDiagnostics } from "./browser";
import { type E2EBrowserSession, writeArtifactText } from "./browser-session";
import { runE2ECase, type WorkspaceE2EStepRunner } from "./case-runner";
import type { DatasourceConfig } from "./config";
import type { WorkspaceE2EHostedPaymentPermitService } from "./coordination/hosted-payment-permit.service";
import type { WorkspaceE2EProviderVerificationPermitService } from "./coordination/provider-verification-permit.service";
import { type WorkspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import type { E2EDatabase } from "./integrations/database.service";
import type { Runner } from "./runtime";
import { browserSessionFor, log, redact } from "./runtime";
import {
  type WorkspaceE2ECleanup,
  WorkspaceE2ECleanupService,
} from "./services/cleanup";
import type { E2ETelemetryService } from "./services/telemetry";
import type { WorkspaceE2ETimeouts } from "./timeouts";
import type { WorkspaceE2ECase } from "./types";

/** The case's browser session, shared by its body, failure capture, and cleanup. */
type WorkspaceE2ECaseBrowser = {
  readonly artifactDir: string;
  failureCause?: Cause.Cause<WorkspaceE2EError>;
  readonly run: Runner;
  readonly sessionId: string;
  readonly testCase: WorkspaceE2ECase;
};

/**
 * Runs one checkout case on the case runner. The body opens the case's own
 * browser session and starts its diagnostics before the case steps; a
 * genuine failure captures browser artifacts while the session is still
 * open, and the capture's close exports the HAR; cleanup cancels the case's
 * owned reservations while it closes the session.
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
  /** The test's runner; its Scope owns the case's session. */
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
      run,
      sessionId: `${sessionPrefix}-${testCase.id}`,
      testCase,
    };

    yield* runE2ECase({
      body: Effect.fn(function* (step: WorkspaceE2EStepRunner) {
        yield* startCaseBrowser(browser).pipe(
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
        yield* testCase.execute({
          run: browser.run,
          runStep: step,
          session: browser.sessionId,
        });
      }),
      caseId: testCase.id,
      cleanup: finalizeCaseBrowser(
        browser,
        timeouts,
        cleanup,
        datasourceConfig
      ),
      onFailure: (cause) =>
        Effect.suspend(() => {
          browser.failureCause = cause;
          return captureFailureArtifacts(browser, cause, timeouts);
        }),
      watchdogMs: testCase.timeoutMs,
    });
  });

/**
 * The case's session from the runner, which opens it on first use and keeps
 * its outcome: every later call shares the same session, waits for an
 * opening still in progress, or fails with the same opening failure.
 */
const caseSession = (
  browser: WorkspaceE2ECaseBrowser
): Effect.Effect<E2EBrowserSession, WorkspaceE2EError> =>
  browserSessionFor(browser.run, browser.sessionId);

// A browser that fails to open is logged, not fatal: the case's first browser
// step fails with the same opening failure, so it keeps its step id.
const startCaseBrowser = (
  browser: WorkspaceE2ECaseBrowser
): Effect.Effect<void> =>
  caseSession(browser).pipe(
    Effect.flatMap((session) =>
      Effect.forEach(
        ["console", "errors", "requests"] as const,
        session.clearDiagnostics,
        { discard: true }
      )
    ),
    Effect.catch(() =>
      Effect.sync(() =>
        log("Browser HAR capture unavailable; continuing workspace e2e")
      )
    )
  );

const captureFailureArtifacts = (
  browser: WorkspaceE2ECaseBrowser,
  failureCause: Cause.Cause<WorkspaceE2EError>,
  timeouts: WorkspaceE2ETimeouts
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const { artifactDir } = browser;
    const failure = Cause.squash(failureCause);
    yield* writeArtifactText(
      artifactDir,
      "error.txt",
      failure instanceof Error
        ? (failure.stack ?? failure.message)
        : String(failure)
    );
    // A browser still opening is waited for within the capture's bound; one
    // that failed to open has nothing more to capture.
    const session = yield* caseSession(browser).pipe(
      Effect.orElseSucceed(() => undefined)
    );
    if (session) {
      yield* writeArtifactText(
        artifactDir,
        "browser-diagnostics.txt",
        yield* readBrowserPageDiagnostics(session)
      );
      yield* session.captureFailureArtifacts(artifactDir);
    }
    log(`Workspace e2e failure artifacts saved to ${artifactDir}`);
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        log(
          `Workspace e2e failure artifact capture failed: ${redact(String(error))}`
        )
      )
    ),
    Effect.timeoutOrElse({
      duration: `${timeouts.artifactCapture} millis`,
      orElse: () =>
        Effect.sync(() =>
          log(`Browser artifact capture timed out for ${browser.testCase.id}`)
        ),
    }),
    Effect.catchCause((cause) =>
      Effect.sync(() =>
        logAuxiliaryFailure(
          `${browser.testCase.id} browser artifact capture`,
          cause
        )
      )
    )
  );

const finalizeCaseBrowser = (
  browser: WorkspaceE2ECaseBrowser,
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
    // Resolved again, so a browser still opening is waited for within the
    // bound and then closed. Only the bound fails the finalizer: a failed
    // opening or close has nothing left to close.
    const browserClose = collectFinalizerFailure(
      failures,
      `${browser.testCase.id} browser close`,
      runFinalizer(
        `${browser.testCase.id} browser close`,
        caseSession(browser).pipe(
          Effect.flatMap((session) => session.close()),
          Effect.ignore
        ),
        timeouts
      )
    );
    yield* Effect.all([reservationCleanup, browserClose], {
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
