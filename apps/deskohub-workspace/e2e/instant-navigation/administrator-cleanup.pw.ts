import { test } from "@playwright/test";
import { Effect } from "effect";
import {
  prepareWorkspaceE2EAccountJournalReconciliations,
  reconcileWorkspaceE2EAccountJournals,
} from "../account/reconcile";
import {
  instantNavigationAdministratorJournalOwner,
  instantNavigationAdministratorSkipReason,
  makeInstantNavigationAdministratorRuntime,
  readInstantNavigationAdministratorRunId,
} from "./administrator-session";

// Teardown of the administrator setup project: Playwright runs it after the
// administration navigation tests, passed or failed. It deletes exactly the
// journaled administrator, whose cascades remove its sessions and grant.
test("remove the instant navigation administrator", async () => {
  test.skip(
    instantNavigationAdministratorSkipReason !== undefined,
    instantNavigationAdministratorSkipReason
  );
  const runId = await readInstantNavigationAdministratorRunId();
  if (runId === undefined) return;
  const { datasourceConfig, runPromise } =
    makeInstantNavigationAdministratorRuntime();
  await runPromise(
    Effect.gen(function* () {
      const prepared = yield* prepareWorkspaceE2EAccountJournalReconciliations(
        datasourceConfig,
        runId,
        [instantNavigationAdministratorJournalOwner]
      );
      yield* reconcileWorkspaceE2EAccountJournals(datasourceConfig, prepared);
    })
  );
});
