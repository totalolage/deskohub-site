import { Effect } from "effect";
import {
  prepareWorkspaceE2EAccountLaneReconciliation,
  reconcileWorkspaceE2EAccountLane,
} from "../account/reconcile";
import { cleanupCheckoutFlowStates } from "../cleanup";
import { getDatasourceConfig } from "../config";
import { E2ETelemetryService } from "../services/telemetry";
import { workspaceE2ECaseIds } from "./case-catalog";
import { runWorkspaceE2ECleanupWithPreparedCandidates } from "./cleanup-plan";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { readWorkspaceE2ECaseJournals } from "./run-plan";

test("reconcile workspace checkout reservations", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const datasourceConfig = getDatasourceConfig(environment);
  const cleanupError = await runWorkspaceE2ECleanupWithPreparedCandidates({
    readAccountLaneJournal: () =>
      runEffect(
        prepareWorkspaceE2EAccountLaneReconciliation(
          datasourceConfig,
          runContext.runId
        )
      ),
    readCheckoutFlowStates: () =>
      readWorkspaceE2ECaseJournals(workspaceE2ECaseIds),
    reconcile: ({ accountLaneJournal, checkoutFlowStates }) =>
      runEffect(
        Effect.gen(function* () {
          const telemetry = yield* E2ETelemetryService;
          return yield* telemetry.tracePhase({
            effect: Effect.gen(function* () {
              const checkoutError = yield* cleanupCheckoutFlowStates({
                datasourceConfig,
                flowStates: checkoutFlowStates,
                workflowError: undefined,
              });
              yield* reconcileWorkspaceE2EAccountLane(
                datasourceConfig,
                accountLaneJournal
              );
              return checkoutError;
            }),
            phaseId: "suite-cleanup",
          });
        })
      ),
  });
  if (cleanupError) throw cleanupError;
});
