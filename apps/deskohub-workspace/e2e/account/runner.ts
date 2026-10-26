import { Effect, Exit } from "effect";
import { runE2ECase, type WorkspaceE2EStep } from "../case-runner";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
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
  session,
  testCase,
  verifyPages,
}: {
  readonly journalRef: WorkspaceE2EAccountJournalRef;
  readonly session: string;
  readonly testCase: WorkspaceE2EAccountCase;
  readonly verifyPages?: readonly WorkspaceE2EStep<void, E2EDatabase>[];
}): Effect.Effect<void, WorkspaceE2EError, WorkspaceE2EAccountRequirement> =>
  runE2ECase({
    // The case's own cleanup stays inside the watchdog and never replaces an
    // earlier verification failure.
    body: (step) =>
      Effect.acquireUseRelease(
        Effect.interruptible(
          testCase.execute({ journalRef, runStep: step, session })
        ),
        () =>
          Effect.forEach(verifyPages ?? [], (page) => step(page), {
            concurrency: 1,
            discard: true,
          }),
        (completion, useExit) =>
          completion.cleanup.pipe(
            Effect.exit,
            Effect.flatMap((cleanupExit) =>
              Exit.isSuccess(useExit) ? cleanupExit : Effect.void
            )
          )
      ),
    caseId: testCase.id,
    cleanup: Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("flush workspace account e2e journal", {
          cause,
          operation: "flush workspace account e2e journal",
        }),
      try: () => writeWorkspaceE2EAccountJournal(journalRef.journal),
    }),
    watchdogMs: testCase.timeoutMs,
  });
