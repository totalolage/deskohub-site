import { Effect } from "effect";
import { isWorkspaceDeploymentOrigin } from "../config";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { pollUntil } from "../polling";
import { addRedaction } from "../runtime";

/** The automation engine's planner, the route Vercel Cron calls in production. */
export const automationPlannerPath = "/api/cron/workspace/email-automations";

const plannerOperation = "run the email automation planner";

export type WorkspaceE2ECronSecret = { readonly value: string };

/**
 * The Preview deployment's `CRON_SECRET`. Vercel runs cron jobs only for
 * production deployments, so on a preview nothing ticks the automation
 * planner unless the runner calls it the way Vercel Cron would. The value is
 * Preview-only: Production has its own `CRON_SECRET`, so this secret cannot
 * plan anything there. The journey fails closed instead of skipping.
 */
export const resolveWorkspaceE2ECronSecret = (
  environment: Pick<WorkspaceE2EEnvironment, "WORKSPACE_E2E_CRON_SECRET">
): WorkspaceE2ECronSecret => {
  const value = environment.WORKSPACE_E2E_CRON_SECRET;
  if (!value) {
    throw workspaceE2EError(
      "WORKSPACE_E2E_CRON_SECRET must hold the Preview deployment's CRON_SECRET. Provision it as a secret of the protected workspace-checkout-e2e GitHub Actions environment, copied from the deskohub-workspace Vercel project's Preview-only CRON_SECRET (never the Production value), before running the automation journey",
      { operation: "configure the workspace e2e automation planner" }
    );
  }
  addRedaction(value, true);
  return { value };
};

/**
 * Runs one planner tick through the production cron route, authorized as
 * Vercel Cron authorizes it. The request goes outside Playwright, so no trace
 * records its headers, and a failure reports only the HTTP status. Only an
 * immutable Workspace deployment origin receives the protection bypass.
 */
export const tickAutomationPlanner = (input: {
  readonly bypassSecret: string | undefined;
  readonly cronSecret: WorkspaceE2ECronSecret;
  readonly fetch?: typeof fetch;
  readonly origin: string;
  readonly timeoutMs: number;
}): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const headers: Record<string, string> = {
      authorization: `Bearer ${input.cronSecret.value}`,
    };
    if (input.bypassSecret && isWorkspaceDeploymentOrigin(input.origin)) {
      headers["x-vercel-protection-bypass"] = input.bypassSecret;
    }
    const response = yield* Effect.tryPromise({
      catch: () =>
        workspaceE2EError("The email automation planner request failed", {
          operation: plannerOperation,
        }),
      try: (signal) =>
        (input.fetch ?? fetch)(new URL(automationPlannerPath, input.origin), {
          headers,
          redirect: "manual",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(input.timeoutMs),
          ]),
        }),
    });
    yield* Effect.promise(async () => {
      await response.body?.cancel().catch(() => undefined);
    });
    if (!response.ok) {
      return yield* workspaceE2EError(
        `The email automation planner answered ${response.status}`,
        { operation: plannerOperation }
      );
    }
  });

/**
 * Ticks the planner, then observes the engine's progress, until `observe`
 * yields a value. Each tick publishes the units the previous one planned, and
 * queue consumers chain follow-up units between ticks.
 */
export const pollAutomationEngine = <A, E, R>(input: {
  readonly intervalMs: number;
  readonly label: string;
  readonly observe: Effect.Effect<A | undefined, E, R>;
  readonly tick: Effect.Effect<void, WorkspaceE2EError>;
  readonly timeoutMs: number;
}) =>
  pollUntil(input.tick.pipe(Effect.andThen(input.observe)), {
    intervalMs: input.intervalMs,
    label: input.label,
    timeoutMs: input.timeoutMs,
  });
