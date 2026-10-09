import {
  prepareWorkspaceE2EAccountLaneReconciliation,
  reconcileWorkspaceE2EAccountLane,
} from "../account/reconcile";
import {
  cleanupPreparedCheckoutFlowStates,
  prepareCheckoutFlowCleanup,
} from "../cleanup";
import { getDatasourceConfig } from "../config";
import { workspaceE2ECaseIds } from "./case-catalog";
import {
  runWorkspaceE2ECleanupWithPreparedCandidates,
  traceWorkspaceE2ESuiteCleanup,
} from "./cleanup-plan";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { readWorkspaceE2ECaseJournals } from "./run-plan";

test("reconcile workspace checkout reservations", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const datasourceConfig = getDatasourceConfig(environment);
  await runWorkspaceE2ECleanupWithPreparedCandidates({
    readAccountLaneJournal: () =>
      runEffect(
        prepareWorkspaceE2EAccountLaneReconciliation(
          datasourceConfig,
          runContext.runId
        )
      ),
    readCheckoutCleanup: async () => {
      const flowStates =
        await readWorkspaceE2ECaseJournals(workspaceE2ECaseIds);
      return runEffect(
        prepareCheckoutFlowCleanup({ datasourceConfig, flowStates })
      );
    },
    reconcile: ({ accountLaneJournal, checkoutCleanup }) =>
      runEffect(
        traceWorkspaceE2ESuiteCleanup({
          cleanupCheckout: cleanupPreparedCheckoutFlowStates({
            datasourceConfig,
            prepared: checkoutCleanup,
            workflowError: undefined,
          }),
          reconcileAccountLane: reconcileWorkspaceE2EAccountLane(
            datasourceConfig,
            accountLaneJournal
          ),
        })
      ),
  });
});
