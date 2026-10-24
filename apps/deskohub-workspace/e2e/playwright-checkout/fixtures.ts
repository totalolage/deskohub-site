import { Effect } from "effect";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { WorkspaceE2ECaseService } from "../services/cases";
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
  browserRunner: async ({ browser }, use) => {
    const runner = makePlaywrightBrowserRunner(browser);
    try {
      await use(runner);
    } finally {
      await runner.close?.();
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
  readonly run: Runner;
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
        const { getConfig, getDatasourceConfig } = await import("../config");
        const { writeWorkspaceE2EFailureAnnotation } = await import(
          "../github-actions"
        );
        const { workspaceDir } = await import("../runtime");
        const { writeWorkspaceE2ECaseJournal } = await import("./run-plan");
        const config = getConfig(environment);
        const datasourceConfig = getDatasourceConfig(environment);

        const planned = await runEffect(
          Effect.gen(function* () {
            const caseService = yield* WorkspaceE2ECaseService;
            const flowStates: import("../types").CheckoutFlowState[] = [];
            const cases = yield* caseService.reconstructCases({
              allocation: runPlan.runContext.allocation,
              config,
              datasourceConfig,
              flowStates,
              preparation: runPlan.preparation,
              run: browserRunner,
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
              run: browserRunner,
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
            Effect.gen(function* () {
              const caseService = yield* WorkspaceE2ECaseService;
              yield* caseService.runCase({
                artifactRoot: `${workspaceDir}/e2e-artifacts/checkout/cases`,
                datasourceConfig,
                ...(runPlan.runContext.githubRunId
                  ? { reportFailure: writeWorkspaceE2EFailureAnnotation }
                  : {}),
                run: browserRunner,
                sessionPrefix: `workspace-checkout-e2e-${runPlan.runContext.runId}`,
                testCase: selected,
                timeouts: config.timeouts,
              });
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
