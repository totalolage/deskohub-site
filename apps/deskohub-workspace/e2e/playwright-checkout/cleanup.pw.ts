import { Effect } from "effect";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
} from "../account/reconcile";
import {
  cleanupPreparedCheckoutFlowStates,
  prepareCheckoutFlowCleanup,
} from "../cleanup";
import { getDatasourceConfig } from "../config";
import {
  automationReservationCaseId,
  deleteRunAutomationJourneys,
} from "../email-campaigns/automation-reservation-case";
import { E2EDatabase } from "../integrations/database.service";
import { workspaceE2ECaseIds } from "./case-catalog";
import {
  runWorkspaceE2ECleanupWithPreparedCandidates,
  traceWorkspaceE2ESuiteCleanup,
} from "./cleanup-plan";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { workspaceE2ECheckoutJournalOwners } from "./journal-owners";
import { readWorkspaceE2ECaseJournals } from "./run-plan";

test("reconcile workspace checkout reservations", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const datasourceConfig = getDatasourceConfig(environment);
  try {
    // An automation journey whose case never reached its own finalizer could
    // leave an active automation behind. Its runs reference the booked
    // reservation, so they go before checkout cleanup.
    const automationJournals = await readWorkspaceE2ECaseJournals([
      automationReservationCaseId,
    ]);
    await runEffect(
      Effect.gen(function* () {
        const { db } = yield* E2EDatabase;
        yield* deleteRunAutomationJourneys({
          contacts: automationJournals.map((state) => state.data),
          datasourceConfig,
          db,
          runId: runContext.runId,
        });
      })
    );
  } finally {
    await runWorkspaceE2ECleanupWithPreparedCandidates({
      readAccountJournals: () =>
        runEffect(
          prepareWorkspaceE2EAccountJournalReconciliations(
            datasourceConfig,
            runContext.runId,
            workspaceE2ECheckoutJournalOwners
          )
        ),
      readCheckoutCleanup: async () => {
        const flowStates =
          await readWorkspaceE2ECaseJournals(workspaceE2ECaseIds);
        return runEffect(
          prepareCheckoutFlowCleanup({ datasourceConfig, flowStates })
        );
      },
      reconcile: ({ accountJournals, checkoutCleanup }) =>
        runEffect(
          traceWorkspaceE2ESuiteCleanup({
            cleanupCheckout: cleanupPreparedCheckoutFlowStates({
              datasourceConfig,
              prepared: checkoutCleanup,
              workflowError: undefined,
            }),
            reconcileAccountJournals:
              reconcileWorkspaceE2EAccountJournals(accountJournals),
          })
        ),
    });
  }
});
