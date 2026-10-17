import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
  workspaceE2EAccountLaneJournalOwner,
} from "../account/reconcile";
import { workspaceE2EAdministrationJournalOwners } from "../administrators/identities";
import { guestReferralPaymentJournalOwner } from "../cases/guest-referral-payment";
import {
  cleanupPreparedCheckoutFlowStates,
  prepareCheckoutFlowCleanup,
} from "../cleanup";
import { getDatasourceConfig } from "../config";
import { workspaceE2EReferralJournalOwners } from "../referrals/journal-owners";
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
    readAccountJournals: () =>
      runEffect(
        prepareWorkspaceE2EAccountJournalReconciliations(
          datasourceConfig,
          runContext.runId,
          [
            workspaceE2EAccountLaneJournalOwner,
            ...workspaceE2EReferralJournalOwners,
            guestReferralPaymentJournalOwner,
            ...workspaceE2EAdministrationJournalOwners,
          ]
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
          reconcileAccountJournals: reconcileWorkspaceE2EAccountJournals(
            datasourceConfig,
            accountJournals
          ),
        })
      ),
  });
});
