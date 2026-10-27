import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import { openAdminSession } from "../admin-case";
import type { E2EBrowserSession } from "../browser-session";
import { runE2ECase, type WorkspaceE2EStepRunner } from "../case-runner";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { withinWorkspaceE2EDeadline } from "../polling";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EAdministrationCaseId } from "./identities";

/** The signed-out admin browser the case drives, and its preview origin. */
export type AdministratorCaseBrowser = {
  readonly origin: string;
  readonly session: E2EBrowserSession;
};

/**
 * Runs one seeded-session administrator case in its own browser session: the
 * preview access is primed first, every step is traced with its own deadline
 * inside the case watchdog, and the session closes in a bounded finalizer.
 * Suite cleanup deletes the seeded accounts, which cascades their sessions,
 * role grants, and agent consents and tokens.
 */
export const runAdministratorCase = Effect.fn("runAdministratorCase")(
  (input: {
    readonly baseURL: string | undefined;
    readonly body: (
      step: WorkspaceE2EStepRunner,
      admin: AdministratorCaseBrowser
    ) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
    readonly browser: Browser;
    readonly bypassSecret: string | undefined;
    readonly caseId: WorkspaceE2EAdministrationCaseId;
    /** Names the case in the session's open failure. */
    readonly caseName: string;
    /** The case watchdog; the short access cases' budget by default. */
    readonly timeoutMs?: number;
  }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const admin = yield* openAdminSession({
          baseURL: input.baseURL,
          browser: input.browser,
          caseName: input.caseName,
        });
        yield* runE2ECase({
          body: Effect.fn(function* (step: WorkspaceE2EStepRunner) {
            yield* step({
              execute: admin.session.primePreviewAccess(
                admin.origin,
                input.bypassSecret,
                { timeoutMs: workspaceE2ETimeouts.browserAction }
              ),
              id: "prime-preview-bypass",
              timeoutMs: workspaceE2ETimeouts.browserAction,
            });
            yield* input.body(step, admin);
          }),
          caseId: input.caseId,
          cleanup: withinWorkspaceE2EDeadline(
            admin.session.close(),
            `${input.caseId}/cleanup`,
            workspaceE2ETimeouts.browserAction
          ).pipe(Effect.orDie),
          watchdogMs:
            input.timeoutMs ?? workspaceE2ETimeouts.administratorAccessCase,
        });
      })
    )
);
