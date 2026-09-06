import { Cause, Effect, Exit, Option } from "effect";
import {
  WorkspaceE2EError,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "../errors";
import { log } from "../runtime";
import { E2ETelemetryService } from "../services/telemetry";
import type { WorkspaceE2EFailureReporter } from "../suite";
import { formatWorkspaceE2EDuration } from "../timeouts";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../types";
import { writeWorkspaceE2EAccountJournal } from "./journal";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountJournalRef,
  WorkspaceE2EAccountRequirement,
} from "./types";

/**
 * Runs one account case against the shared protected-preview lane. The lane
 * keeps one browser session for the whole serial project. It requests no
 * automatic browser screenshots, traces, videos, HARs, or console/network
 * diagnostics; the lane may explicitly capture only allowlisted stable-page
 * PNGs from its synthetic browser context for PR review only. It flushes the
 * exact-ID lane journal after every case so interrupted runs leave a complete
 * ownership record for the suite cleanup. Only fixed step and failure codes
 * leave the boundary.
 */
export const runWorkspaceE2EAccountCase = ({
  journalRef,
  reportFailure,
  session,
  testCase,
  verifyPage,
}: {
  readonly journalRef: WorkspaceE2EAccountJournalRef;
  readonly reportFailure?: WorkspaceE2EFailureReporter;
  readonly session: string;
  readonly testCase: WorkspaceE2EAccountCase;
  readonly verifyPage?: WorkspaceE2EStep<void>;
}): Effect.Effect<void, WorkspaceE2EError, WorkspaceE2EAccountRequirement> =>
  Effect.scoped(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      const startedAt = Date.now();
      const runStep: WorkspaceE2EStepRunner = (step) => {
        const operation = `${testCase.id}/${step.id}`;
        return telemetry.traceStep({
          caseId: testCase.id,
          effect: Effect.suspend(() =>
            Effect.sync(() => log(`STEP START ${operation}`)).pipe(
              Effect.andThen(
                step.execute.pipe(
                  Effect.timeoutOrElse({
                    duration: `${step.timeoutMs} millis`,
                    orElse: () =>
                      workspaceE2ETimeoutError(
                        `Timed out running ${operation} after ${formatWorkspaceE2EDuration(step.timeoutMs)}`,
                        { operation }
                      ),
                  })
                )
              ),
              Effect.onExit((exit) =>
                Effect.sync(() =>
                  log(
                    `STEP ${Exit.isSuccess(exit) ? "PASS" : "FAIL"} ${operation}`
                  )
                )
              )
            )
          ),
          stepId: step.id,
          timeoutMs: step.timeoutMs,
        });
      };

      const executeCase = Effect.gen(function* () {
        yield* testCase.execute({ journalRef, runStep, session });
        if (verifyPage) yield* runStep(verifyPage);
      });

      const traced = telemetry.traceCase({
        caseId: testCase.id,
        effect: Effect.acquireUseRelease(
          Effect.sync(() => log(`CASE START ${testCase.id}`)),
          () =>
            executeCase.pipe(
              Effect.timeoutOrElse({
                duration: `${testCase.timeoutMs} millis`,
                orElse: () =>
                  workspaceE2ETimeoutError(
                    `Timed out running ${testCase.id} e2e case after ${formatWorkspaceE2EDuration(testCase.timeoutMs)}`,
                    { operation: `${testCase.id} e2e case` }
                  ),
              })
            ),
          () =>
            telemetry.tracePhase({
              caseId: testCase.id,
              effect: Effect.tryPromise({
                catch: (cause) =>
                  workspaceE2EError("flush workspace account e2e journal", {
                    cause,
                    operation: "flush workspace account e2e journal",
                  }),
                try: () => writeWorkspaceE2EAccountJournal(journalRef.journal),
              }),
              phaseId: "case-finalization",
            })
        ),
        timeoutMs: testCase.timeoutMs,
      });

      yield* reportFailure
        ? traced.pipe(
            Effect.tapCause((cause) =>
              Effect.sync(() => {
                if (Cause.hasInterruptsOnly(cause)) return;
                const found = Cause.findErrorOption(cause);
                const error = Option.isSome(found) ? found.value : undefined;
                reportFailure({
                  caseId: testCase.id,
                  ...(error instanceof WorkspaceE2EError && error.diagnosticCode
                    ? { diagnosticCode: error.diagnosticCode }
                    : {}),
                  failureKind: "error",
                  outcome: "failed",
                });
              })
            )
          )
        : traced;
      log(
        `CASE SETTLED ${testCase.id} (${formatWorkspaceE2EDuration(Date.now() - startedAt)})`
      );
    })
  );
