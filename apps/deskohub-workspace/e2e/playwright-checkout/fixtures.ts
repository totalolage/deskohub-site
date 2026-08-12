import { Effect } from "effect";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { WorkspaceE2ECaseService } from "../services/cases";
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

export { expect } from "@playwright/test";

export const registerWorkspaceE2ECases = (
  caseIds: readonly string[],
  options: { readonly serial?: boolean } = {}
) => {
  const register = () => {
    for (const caseId of caseIds) {
      test(
        caseId,
        async ({ browserRunner, environment, runEffect, runPlan }) => {
          const { getConfig, getDatasourceConfig } = await import("../config");
          const { writeWorkspaceE2EFailureAnnotation } = await import(
            "../github-actions"
          );
          const { workspaceDir } = await import("../runtime");
          const { writeWorkspaceE2ECaseJournal } = await import("./run-plan");
          const config = getConfig(environment);
          const datasourceConfig = getDatasourceConfig(environment);

          await runEffect(
            Effect.gen(function* () {
              const caseService = yield* WorkspaceE2ECaseService;
              const flowStates: import("../types").CheckoutFlowState[] = [];
              const cases = yield* caseService.makeCases({
                allocation: runPlan.runContext.allocation,
                config,
                datasourceConfig,
                flowStates,
                preparation: runPlan.preparation,
                run: browserRunner,
              });
              const selected = cases.find((testCase) => testCase.id === caseId);
              if (!selected) {
                return yield* Effect.die(
                  new Error(`Workspace E2E case ${caseId} was not constructed`)
                );
              }
              yield* Effect.promise(() =>
                writeWorkspaceE2ECaseJournal(
                  selected.id as import("./case-catalog").WorkspaceE2ECaseId,
                  selected.checkoutStates
                )
              );
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
        }
      );
    }
  };

  if (options.serial) {
    test.describe.configure({ mode: "serial" });
  }
  register();
};
