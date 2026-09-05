import "../../shared/polyfills/temporal";

import { Effect } from "effect";
import { workspaceE2EError } from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import { runtimeTest } from "../playwright-checkout/runtime-fixtures";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStep } from "../types";
import {
  type WorkspaceE2EAccountCaseId,
  workspaceE2EAccountCaseIds,
} from "./catalog";
import { getAccountE2EConfig } from "./config";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "./journal";
import { verifyProfileNavigation } from "./profile-navigation";
import { makeMagicLinkRateBudget } from "./rate-budget";
import {
  type AccountReviewTarget,
  captureAccountReview,
} from "./review-screenshots";
import type { WorkspaceE2EAccountDeletionHandoff } from "./types";

const accountReviewTargetByCaseId: Partial<
  Record<WorkspaceE2EAccountCaseId, AccountReviewTarget>
> = {
  "account-anonymous-redirect": "sign-in-desktop",
  "account-sign-in-form": "sign-in-accepted-desktop",
  "account-magic-link-delivery": "completion-mobile375x900",
  "account-profile-completion": "linked-desktop1440x1000",
  "account-reservation-transitions": "linked-history-desktop",
  "account-deletion-marker-reauth": "callback-failed-desktop",
  "account-linking-variants": "support-desktop",
};
const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

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
  accountTest(
    caseId,
    async ({ accountLane, browser, environment, runEffect }) => {
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
      const verifyPage: WorkspaceE2EStep<void> | undefined =
        caseId === "account-profile-completion"
          ? {
              execute: Effect.tryPromise({
                catch: () =>
                  workspaceE2EError(
                    "verify profile navigation and unsaved changes failed",
                    {
                      operation:
                        "verify profile navigation and unsaved changes",
                    }
                  ),
                try: async () => {
                  const pages = browser
                    .contexts()
                    .flatMap((context) => context.pages());
                  if (pages.length !== 1)
                    throw new Error(accountReviewCaptureFailureMessage);
                  const page = pages[0];
                  if (!page)
                    throw new Error(accountReviewCaptureFailureMessage);
                  await verifyProfileNavigation(
                    page,
                    accountLane.config.baseUrl
                  );
                },
              }),
              id: "checks profile re-entry and unsaved navigation",
              timeoutMs: workspaceE2ETimeouts.providerTransition,
            }
          : undefined;
      await runEffect(
        runWorkspaceE2EAccountCase({
          journalRef: accountLane.journalRef,
          reportFailure: writeWorkspaceE2EFailureAnnotation,
          session: accountLane.session,
          testCase: selected,
          ...(verifyPage ? { verifyPage } : {}),
        })
      );

      const target = accountReviewTargetByCaseId[caseId];
      if (!target) return;

      const pages = browser.contexts().flatMap((context) => context.pages());
      if (pages.length !== 1)
        throw new Error(accountReviewCaptureFailureMessage);
      const page = pages[0];
      if (!page) throw new Error(accountReviewCaptureFailureMessage);

      await accountTest.step(`capture account review: ${target}`, async () => {
        await captureAccountReview(page, accountLane.config.baseUrl, target);
      });

      if (caseId !== "account-linking-variants") return;

      await accountTest.step(
        "capture deleted account review after sign out",
        async () => {
          const baseUrl = accountLane.config.baseUrl;
          await Promise.all([
            page.waitForURL(new URL("/en-US", baseUrl).toString(), {
              timeout: workspaceE2ETimeouts.browserNavigation,
            }),
            page
              .getByRole("button", { name: "Sign out", exact: true })
              .click({ timeout: workspaceE2ETimeouts.browserAction }),
          ]);
          await page.goto(
            new URL("/en-US/account/deleted", baseUrl).toString(),
            { timeout: workspaceE2ETimeouts.browserNavigation }
          );
          await page
            .getByRole("heading", {
              exact: true,
              level: 1,
              name: "Your account was deleted",
            })
            .waitFor({
              state: "visible",
              timeout: workspaceE2ETimeouts.browserAction,
            });
          await captureAccountReview(page, baseUrl, "deleted-desktop");
        }
      );
    }
  );
}
