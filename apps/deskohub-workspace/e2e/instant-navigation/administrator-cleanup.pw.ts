import { Effect } from "effect";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
} from "../account/reconcile";
import {
  instantNavigationAdministratorJournalOwner,
  instantNavigationAdministratorSkipReason,
  readInstantNavigationAdministratorRunId,
  instantNavigationAdministratorTest as test,
} from "./administrator-session";

// Skipped before the administrator runtime fixture reads the environment.
test.skip(
  instantNavigationAdministratorSkipReason !== undefined,
  instantNavigationAdministratorSkipReason
);

// Teardown of the administrator setup project: Playwright runs it after the
// administration navigation tests, passed or failed. It deletes exactly the
// journaled administrator, whose cascades remove its sessions and grant.
test("remove the instant navigation administrator", async ({
  administratorRuntime,
}) => {
  const { datasourceConfig, runEffect } = administratorRuntime;
  const runId = await readInstantNavigationAdministratorRunId();
  if (runId === undefined) return;
  await runEffect(
    Effect.gen(function* () {
      const prepared = yield* prepareWorkspaceE2EAccountJournalReconciliations(
        datasourceConfig,
        runId,
        [instantNavigationAdministratorJournalOwner]
      );
      yield* reconcileWorkspaceE2EAccountJournals(prepared);
    })
  );
});
