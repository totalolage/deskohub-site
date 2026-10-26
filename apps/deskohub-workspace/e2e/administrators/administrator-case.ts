import type { BrowserContext } from "@playwright/test";
import { Effect } from "effect";
import { primePreviewBypass, sanitizedBrowserOperation } from "../admin-case";
import { runE2ECase, type WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { withinWorkspaceE2EDeadline } from "../polling";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EAdministrationCaseId } from "./identities";

/**
 * Runs one seeded-session administrator case: the bypass is primed first,
 * every step is traced with its own deadline inside the case watchdog, and
 * the context closes in a bounded finalizer. Suite cleanup deletes the seeded
 * accounts, which cascades their sessions, role grants, and agent consents
 * and tokens.
 */
export const runAdministratorCase = Effect.fn("runAdministratorCase")(
  (input: {
    readonly body: (
      step: WorkspaceE2EStepRunner
    ) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
    readonly bypassSecret: string | undefined;
    readonly caseId: WorkspaceE2EAdministrationCaseId;
    readonly context: BrowserContext;
    readonly origin: string;
    /** The case watchdog; the short access cases' budget by default. */
    readonly timeoutMs?: number;
  }) =>
    runE2ECase({
      body: Effect.fn(function* (step: WorkspaceE2EStepRunner) {
        yield* step({
          execute: primePreviewBypass({
            bypassSecret: input.bypassSecret,
            context: input.context,
            origin: input.origin,
          }),
          id: "prime-preview-bypass",
          timeoutMs: workspaceE2ETimeouts.browserAction,
        });
        yield* input.body(step);
      }),
      caseId: input.caseId,
      cleanup: withinWorkspaceE2EDeadline(
        sanitizedBrowserOperation(
          `close the ${input.caseId} browser context`,
          () => input.context.close()
        ),
        `${input.caseId}/cleanup`,
        workspaceE2ETimeouts.browserAction
      ).pipe(Effect.orDie),
      watchdogMs:
        input.timeoutMs ?? workspaceE2ETimeouts.administratorAccessCase,
    })
);
