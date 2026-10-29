import { Effect, Exit, Scope } from "effect";
import { runUntracedE2EEffect } from "../effect-edge";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import {
  isWorkspaceE2ENightlyCaseId,
  isWorkspaceE2EOfficeCaseId,
} from "./case-catalog";
import { readWorkspaceE2ERunPlan } from "./run-plan";
import { runtimeTest } from "./runtime-fixtures";

type WorkspaceE2EFixtures = {
  readonly browserRunner: Runner;
};

type WorkspaceE2EWorkerFixtures = {
  readonly runPlan: Awaited<ReturnType<typeof readWorkspaceE2ERunPlan>>;
};

export const test = runtimeTest.extend<
  WorkspaceE2EFixtures,
  WorkspaceE2EWorkerFixtures
>({
  // The test's Scope owns its browser sessions: the case's one session opens
  // there on first use, inside the case runner, so a browser that fails to
  // open is still the case's failure; closing the Scope closes every session,
  // each release bounded by one browser action.
  browserRunner: async ({ browser }, use) => {
    const scope = Scope.makeUnsafe("parallel");
    try {
      await use(makePlaywrightBrowserRunner(browser, { scope }));
    } finally {
      await runUntracedE2EEffect(Scope.close(scope, Exit.void));
    }
  },
  runPlan: [
    async ({ browserName: _browserName }, use) =>
      use(await readWorkspaceE2ERunPlan()),
    { scope: "worker" },
  ],
});

/**
 * Binds a planned case to state only its own test may create, such as seeded
 * run-scoped synthetic identities, before the case runner admits it.
 */
export type WorkspaceE2ECaseBinder = (input: {
  /** The worker browser; the case's own session context is its only one. */
  readonly browser: import("@playwright/test").Browser;
  readonly environment: import("../e2e-env").WorkspaceE2EEnvironment;
  readonly runId: import("../run-identifiers").WorkspaceE2ERunId;
  readonly testCase: import("../types").WorkspaceE2ECase;
}) => Promise<import("../types").WorkspaceE2ECase>;

export const registerWorkspaceE2ECases = (
  caseIds: readonly string[],
  options: { readonly bindCase?: WorkspaceE2ECaseBinder } = {}
) => {
  for (const caseId of caseIds) {
    test(
      caseId,
      async ({ browser, browserRunner, environment, runEffect, runPlan }) => {
        const { nightlyCasesEnabled } = await import("../e2e-env");
        test.skip(
          isWorkspaceE2ENightlyCaseId(caseId) &&
            !nightlyCasesEnabled(environment),
          "Runs only in the nightly Workspace E2E"
        );
        const { makeWorkspaceE2ECases } = await import("../cases");
        const { getConfig, getDatasourceConfig } = await import("../config");
        const { workspaceDir } = await import("../runtime");
        const { runWorkspaceE2ECase } = await import("../suite");
        const { writeWorkspaceE2ECaseJournal } = await import("./run-plan");
        const config = getConfig(environment);
        const datasourceConfig = getDatasourceConfig(environment);

        const planned = await runEffect(
          Effect.gen(function* () {
            const flowStates: import("../types").CheckoutFlowState[] = [];
            const cases = yield* makeWorkspaceE2ECases({
              allocation: runPlan.runContext.allocation,
              config,
              datasourceConfig,
              flowStates,
              preparation: runPlan.preparation,
              traceConstruction: false,
            });
            const selected = cases.find((testCase) => testCase.id === caseId);
            return selected;
          })
        );
        if (!planned) {
          test.skip(
            isWorkspaceE2EOfficeCaseId(caseId),
            "The office page is disabled in this preview"
          );
          throw new Error(`Workspace E2E case ${caseId} was not constructed`);
        }
        const selected = options.bindCase
          ? await options.bindCase({
              browser,
              environment,
              runId: runPlan.runContext.runId,
              testCase: planned,
            })
          : planned;

        const journalStartedAt = new Date();
        await writeWorkspaceE2ECaseJournal(
          selected.id as import("./case-catalog").WorkspaceE2ECaseId,
          selected.checkoutStates,
          journalStartedAt
        );
        try {
          await runEffect(
            runWorkspaceE2ECase({
              artifactRoot: `${workspaceDir}/e2e-artifacts/checkout/cases`,
              datasourceConfig,
              run: browserRunner,
              sessionPrefix: `workspace-checkout-e2e-${runPlan.runContext.runId}`,
              testCase: selected,
              timeouts: config.timeouts,
            })
          );
        } finally {
          await writeWorkspaceE2ECaseJournal(
            selected.id as import("./case-catalog").WorkspaceE2ECaseId,
            selected.checkoutStates,
            journalStartedAt
          );
        }
      }
    );
  }
};
