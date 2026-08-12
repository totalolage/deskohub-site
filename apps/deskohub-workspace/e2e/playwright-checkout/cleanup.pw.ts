import { cleanupCheckoutFlowStates } from "../cleanup";
import { getDatasourceConfig } from "../config";
import { workspaceE2ECaseIds } from "./case-catalog";
import { readWorkspaceE2ECaseJournals } from "./run-plan";
import { runtimeTest as test } from "./runtime-fixtures";

test("reconcile workspace checkout reservations", async ({
  environment,
  runEffect,
}) => {
  const datasourceConfig = getDatasourceConfig(environment);
  const flowStates = await readWorkspaceE2ECaseJournals(workspaceE2ECaseIds);
  const cleanupError = await runEffect(
    cleanupCheckoutFlowStates({
      datasourceConfig,
      flowStates,
      workflowError: undefined,
    })
  );
  if (cleanupError) throw cleanupError;
});
