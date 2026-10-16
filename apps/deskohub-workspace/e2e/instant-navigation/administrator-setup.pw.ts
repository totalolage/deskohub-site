import { test } from "@playwright/test";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import { makeWorkspaceE2EAdministrationIdentities } from "../administrators/identities";
import { resolveWorkspaceE2ERunContext } from "../playwright-checkout/run-context";
import {
  instantNavigationAdministratorJournalOwner,
  instantNavigationAdministratorLabel,
  instantNavigationAdministratorSkipReason,
  makeInstantNavigationAdministratorRuntime,
  writeInstantNavigationAdministratorRunId,
} from "./administrator-session";

// Seeds the one synthetic administrator the administration navigation tests
// sign in as. The run id is persisted before the journal, and the journal
// before the user row, so the teardown project can always reconcile it.
test("seed the instant navigation administrator", async () => {
  test.skip(
    instantNavigationAdministratorSkipReason !== undefined,
    instantNavigationAdministratorSkipReason
  );
  const { environment, runPromise } =
    makeInstantNavigationAdministratorRuntime();
  const { runId } = resolveWorkspaceE2ERunContext(environment);
  await writeInstantNavigationAdministratorRunId(runId);
  const identities = makeWorkspaceE2EAdministrationIdentities<
    typeof instantNavigationAdministratorLabel
  >({
    journalDirectory: instantNavigationAdministratorJournalOwner.journalDirectory,
    ownerId: instantNavigationAdministratorJournalOwner.ownerId,
    runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  await runPromise(
    identities.seed(instantNavigationAdministratorLabel, ["administrator"])
  );
});
