import type { BrowserContext } from "@playwright/test";
import { Effect } from "effect";
import {
  primePreviewBypass,
  reportAdminCaseFailure,
  runFinalizedCase,
  sanitizedBrowserOperation,
} from "../admin-case";
import type { WorkspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { withinWorkspaceE2EDeadline } from "../polling";
import { E2ETelemetryService, toE2EResult } from "../services/telemetry";
import type { WorkspaceE2EFailureReporter } from "../suite";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EAdministrationCaseId } from "./identities";

/** One traced case step with its own deadline. */
export type AdministratorCaseStep = <A, R>(
  stepId: string,
  timeoutMs: number,
  execute: Effect.Effect<A, WorkspaceE2EError, R>
) => Effect.Effect<A, WorkspaceE2EError, R>;

/**
 * Runs one seeded-session administrator case: the bypass is primed first,
 * every step is traced with its own deadline inside the case watchdog, and
 * the context closes in a bounded finalizer. Suite cleanup deletes the seeded
 * accounts, which cascades their sessions, role grants, and agent consents
 * and tokens.
 */
export const runAdministratorCase = Effect.fn("runAdministratorCase")(
  function* (input: {
    readonly body: (
      step: AdministratorCaseStep
    ) => Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
    readonly bypassSecret: string | undefined;
    readonly caseId: WorkspaceE2EAdministrationCaseId;
    readonly context: BrowserContext;
    readonly origin: string;
    readonly reportFailure?: WorkspaceE2EFailureReporter;
    /** The case watchdog; the short access cases' budget by default. */
    readonly timeoutMs?: number;
  }) {
    const telemetry = yield* E2ETelemetryService;
    const timeoutMs =
      input.timeoutMs ?? workspaceE2ETimeouts.administratorAccessCase;
    let terminalStepId: string | undefined;

    const step: AdministratorCaseStep = (stepId, stepTimeoutMs, execute) => {
      const operation = `${input.caseId}/${stepId}`;
      return telemetry.traceStep({
        caseId: input.caseId,
        effect: Effect.onExit(
          withinWorkspaceE2EDeadline(execute, operation, stepTimeoutMs),
          (exit) =>
            Effect.sync(() => {
              if (toE2EResult(exit).outcome !== "passed") {
                terminalStepId = stepId;
              }
            })
        ),
        stepId,
        timeoutMs: stepTimeoutMs,
      });
    };

    yield* runFinalizedCase({
      body: withinWorkspaceE2EDeadline(
        Effect.gen(function* () {
          yield* step(
            "prime-preview-bypass",
            workspaceE2ETimeouts.browserAction,
            primePreviewBypass({
              bypassSecret: input.bypassSecret,
              context: input.context,
              origin: input.origin,
            })
          );
          yield* input.body(step);
        }),
        `${input.caseId} e2e case`,
        timeoutMs
      ),
      cleanup: withinWorkspaceE2EDeadline(
        sanitizedBrowserOperation(
          `close the ${input.caseId} browser context`,
          () => input.context.close()
        ),
        `${input.caseId}/cleanup`,
        workspaceE2ETimeouts.browserAction
      ).pipe(Effect.orDie),
      trace: (effect) =>
        telemetry.traceCase({
          caseId: input.caseId,
          effect,
          timeoutMs,
        }),
      onExit: reportAdminCaseFailure({
        caseId: input.caseId,
        reportFailure: input.reportFailure,
        terminalStepId: () => terminalStepId,
      }),
    });
  }
);
