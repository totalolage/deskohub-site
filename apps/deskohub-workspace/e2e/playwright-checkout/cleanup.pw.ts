import { Effect } from "effect";
import { cleanupCheckoutFlowStates } from "../cleanup";
import { getDatasourceConfig } from "../config";
import { E2ETelemetryService } from "../services/telemetry";
import { workspaceE2ECaseIds } from "./case-catalog";
import { cleanupTest as test } from "./cleanup-runtime-fixtures";
import { readWorkspaceE2ECaseJournals } from "./run-plan";

test("reconcile workspace checkout reservations", async ({
  environment,
  runEffect,
}) => {
  const datasourceConfig = getDatasourceConfig(environment);
  const flowStates = await readWorkspaceE2ECaseJournals(workspaceE2ECaseIds);
  const cleanupError = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return yield* telemetry.tracePhase({
        effect: cleanupCheckoutFlowStates({
          datasourceConfig,
          flowStates,
          workflowError: undefined,
        }),
        phaseId: "suite-cleanup",
      });
    })
  );
  if (cleanupError) throw cleanupError;
});
