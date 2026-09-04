import "../../shared/polyfills/temporal";

import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { runtimeTest } from "../playwright-checkout/runtime-fixtures";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { workspaceE2EAccountCaseIds } from "./catalog";
import { getAccountE2EConfig } from "./config";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "./journal";
import { makeMagicLinkRateBudget } from "./rate-budget";
import type { WorkspaceE2EAccountDeletionHandoff } from "./types";

type WorkspaceE2EAccountLane = {
  readonly config: ReturnType<typeof getAccountE2EConfig>;
  /**
   * The one mutable deletion handoff for the whole worker. The case factory
   * runs again for every Playwright test, so this object must outlive it;
   * it stays in memory only and never joins the cleanup journal.
   */
  readonly deletionHandoff: WorkspaceE2EAccountDeletionHandoff;
  readonly journalRef: {
    readonly journal: WorkspaceE2EAccountJournal;
    readonly record: (update: {
      readonly authUserIds: readonly string[];
      readonly dotyposCustomerIds: readonly string[];
      readonly dotyposReservationIds: readonly string[];
    }) => Promise<void>;
  };
  readonly rateBudget: ReturnType<typeof makeMagicLinkRateBudget>;
  readonly run: Runner;
  readonly session: string;
};

type WorkspaceE2EAccountWorkerFixtures = {
  readonly accountLane: WorkspaceE2EAccountLane;
};

/**
 * The serial account lane: one worker, one browser session shared by every
 * case, no HAR recording, and one exact-ID journal covering the whole lane.
 * The serial order is the lifecycle order; Playwright still owns admission,
 * fail-fast, and teardown.
 */
const accountTest = runtimeTest.extend<
  Record<never, never>,
  WorkspaceE2EAccountWorkerFixtures
>({
  accountLane: [
    async ({ browser, environment, runContext }, use) => {
      const config = getAccountE2EConfig(environment, runContext.runId);
      const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
      const deletionHandoff: WorkspaceE2EAccountDeletionHandoff = {};
      let journal = emptyWorkspaceE2EAccountJournal();
      const mergeIds = (
        existing: readonly string[],
        added: readonly string[]
      ) => [...existing, ...added.filter((value) => !existing.includes(value))];
      const journalRef = {
        get journal(): WorkspaceE2EAccountJournal {
          return journal;
        },
        record: async (update: {
          readonly authUserIds: readonly string[];
          readonly dotyposCustomerIds: readonly string[];
          readonly dotyposReservationIds: readonly string[];
        }) => {
          journal = {
            ...journal,
            authUserIds: mergeIds(journal.authUserIds, update.authUserIds),
            dotyposCustomerIds: mergeIds(
              journal.dotyposCustomerIds,
              update.dotyposCustomerIds
            ),
            dotyposReservationIds: mergeIds(
              journal.dotyposReservationIds,
              update.dotyposReservationIds
            ),
          };
          await writeWorkspaceE2EAccountJournal(journal);
        },
      };
      try {
        await use({
          config,
          deletionHandoff,
          journalRef,
          rateBudget: makeMagicLinkRateBudget(),
          run,
          session: `workspace-account-e2e-${runContext.runId}`,
        });
      } finally {
        await run.close?.();
      }
    },
    { scope: "worker" },
  ],
});

accountTest.describe.configure({ mode: "serial" });

for (const caseId of workspaceE2EAccountCaseIds) {
  accountTest(caseId, async ({ accountLane, environment, runEffect }) => {
    const { makeWorkspaceE2EAccountCases } = await import("./cases");
    const { getDatasourceConfig } = await import("../config");
    const { runWorkspaceE2EAccountCase } = await import("./runner");
    const cases = makeWorkspaceE2EAccountCases({
      config: accountLane.config,
      datasourceConfig: getDatasourceConfig(environment),
      deletionHandoff: accountLane.deletionHandoff,
      rateBudget: accountLane.rateBudget,
      run: accountLane.run,
      session: accountLane.session,
    });
    const selected = cases.find((testCase) => testCase.id === caseId);
    if (!selected) {
      throw new Error(`Workspace account E2E case ${caseId} was not built`);
    }
    await runEffect(
      runWorkspaceE2EAccountCase({
        journalRef: accountLane.journalRef,
        reportFailure: writeWorkspaceE2EFailureAnnotation,
        session: accountLane.session,
        testCase: selected,
      })
    );
  });
}
