import "../../shared/polyfills/temporal";

import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import type { AccountSection } from "@/features/account/components/shell/account-shell";
import { workspaceE2EError } from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import type { E2EDatabase } from "../integrations/database.service";
import { runtimeTest } from "../playwright-checkout/runtime-fixtures";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStep } from "../types";
import { verifyAccountLayoutNavigation } from "./account-layout-navigation";
import {
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
} from "./auth-rows";
import { withCallbackHandoffReview } from "./callback-handoff";
import {
  type WorkspaceE2EAccountCaseId,
  workspaceE2EAccountCaseIds,
} from "./catalog";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
  workspaceE2EAccountMainRecipientLabel,
} from "./config";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "./journal";
import { verifyProfileNavigation } from "./profile-navigation";
import { makeMagicLinkRateBudget } from "./rate-budget";
import { withWorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";
import {
  toWorkspaceE2EReservationHistoryFailure,
  verifyWorkspaceE2EReservationHistoryNavigation,
} from "./reservation-navigation";
import {
  type AccountReviewTarget,
  captureAccountReview,
  captureReservationStatusReview,
  withSignInPendingReview,
} from "./review-screenshots";
import type { WorkspaceE2EAccountLifecycleHandoff } from "./types";

const accountReviewTargetByCaseId: Partial<
  Record<WorkspaceE2EAccountCaseId, AccountReviewTarget>
> = {
  "account-anonymous-redirect": "sign-in-desktop",
  "account-sign-in-form": "sign-in-accepted-desktop",
  "account-magic-link-delivery": "completion-mobile375x900",
  "account-session-lifecycle": "callback-failed-desktop",
  "account-linking-variants": "support-desktop",
};
const accountReviewTargetBySection = {
  reservations: "linked-reservations-desktop",
  profile: "linked-profile-desktop",
  billing: "linked-billing-desktop",
  legal: "linked-legal-desktop",
  danger: "linked-danger-desktop",
} as const satisfies Readonly<Record<AccountSection, AccountReviewTarget>>;
const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

type WorkspaceE2EAccountLane = {
  readonly config: ReturnType<typeof getAccountE2EConfig>;
  /**
   * The one mutable lifecycle handoff for the whole worker. The case factory
   * runs again for every Playwright test, so this object must outlive it;
   * it stays in memory only and never joins the cleanup journal.
   */
  readonly lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff;
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
    async ({ browser, environment, runContext }, applyFixture) => {
      const config = getAccountE2EConfig(environment, runContext.runId);
      const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
      const lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff = {};
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
        await applyFixture({
          config,
          lifecycleHandoff,
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
      const datasourceConfig = getDatasourceConfig(environment);
      const cases = makeWorkspaceE2EAccountCases({
        config: accountLane.config,
        datasourceConfig,
        lifecycleHandoff: accountLane.lifecycleHandoff,
        rateBudget: accountLane.rateBudget,
        run: accountLane.run,
        session: accountLane.session,
      });
      const selected = cases.find((testCase) => testCase.id === caseId);
      if (!selected) {
        throw new Error(`Workspace account E2E case ${caseId} was not built`);
      }
      const getOwnedPage = () => {
        const pages = browser.contexts().flatMap((context) => context.pages());
        if (pages.length !== 1)
          throw new Error(accountReviewCaptureFailureMessage);
        const page = pages[0];
        if (!page) throw new Error(accountReviewCaptureFailureMessage);
        return page;
      };
      let verifyPage: WorkspaceE2EStep<void, E2EDatabase> | undefined;
      if (caseId === "account-profile-completion") {
        verifyPage = {
          execute: Effect.tryPromise({
            catch: () =>
              workspaceE2EError(
                "verify profile navigation and unsaved changes failed",
                {
                  operation: "verify profile navigation and unsaved changes",
                }
              ),
            try: async () => {
              await verifyProfileNavigation(
                getOwnedPage(),
                accountLane.config.baseUrl
              );
            },
          }),
          id: "checks profile re-entry and unsaved navigation",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        };
      } else if (caseId === "account-reservation-transitions") {
        verifyPage = {
          execute: Effect.gen(function* () {
            const page = getOwnedPage();
            yield* Effect.tryPromise({
              catch: () =>
                workspaceE2EError("verify account layout navigation failed", {
                  operation: "verify account layout navigation",
                }),
              try: () =>
                verifyAccountLayoutNavigation(page, async (section) => {
                  await captureAccountReview(
                    page,
                    accountLane.config.baseUrl,
                    accountReviewTargetBySection[section]
                  );
                }),
            });

            const recipient = makeWorkspaceE2EAccountRecipient(
              accountLane.config,
              workspaceE2EAccountMainRecipientLabel
            );
            const userId = yield* findAuthUserIdByEmail(recipient);
            if (!userId) {
              return yield* workspaceE2EError(
                "The account reservation history fixture has no synthetic user",
                {
                  diagnosticCode: "postgres_account_fixture_assertion_failed",
                  operation: "read account reservation history user",
                }
              );
            }
            const customerId = yield* findLinkedDotyposCustomerId(userId);
            if (!customerId) {
              return yield* workspaceE2EError(
                "The account reservation history fixture has no linked customer",
                {
                  diagnosticCode: "postgres_account_fixture_assertion_failed",
                  operation: "read account reservation history customer",
                }
              );
            }
            const [firstReservationId, secondReservationId] =
              accountLane.journalRef.journal.dotyposReservationIds;
            if (!firstReservationId || !secondReservationId) {
              return yield* workspaceE2EError(
                "The account reservation history case did not journal both provider reservations",
                {
                  diagnosticCode: "postgres_account_fixture_assertion_failed",
                  operation: "read account reservation history journal",
                }
              );
            }

            yield* withWorkspaceE2EReservationHistoryFixture(
              {
                customerId: DotyposCustomerIdSchema.make(customerId),
                datasourceConfig,
                dotyposReservationId:
                  DotyposReservationIdSchema.make(firstReservationId),
              },
              (fixture) =>
                Effect.tryPromise({
                  catch: toWorkspaceE2EReservationHistoryFailure,
                  try: () =>
                    verifyWorkspaceE2EReservationHistoryNavigation({
                      baseUrl: accountLane.config.baseUrl,
                      browser,
                      bypassSecret: accountLane.config.bypassSecret,
                      captureStatusReview: (stage) =>
                        captureReservationStatusReview(
                          getOwnedPage(),
                          accountLane.config.baseUrl,
                          stage === "modal"
                            ? "reservation-status-modal-desktop"
                            : "reservation-status-details-desktop",
                          fixture.reservationId
                        ),
                      fixture,
                      page: getOwnedPage(),
                    }),
                })
            );
          }),
          id: "checks reservation history navigation and access privacy",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        };
      }
      const runCase = () =>
        runEffect(
          runWorkspaceE2EAccountCase({
            journalRef: accountLane.journalRef,
            reportFailure: writeWorkspaceE2EFailureAnnotation,
            session: accountLane.session,
            testCase: selected,
            ...(verifyPage ? { verifyPage } : {}),
          })
        );

      if (caseId === "account-sign-in-form") {
        const pages = browser.contexts().flatMap((context) => context.pages());
        if (pages.length !== 1)
          throw new Error(accountReviewCaptureFailureMessage);
        const page = pages[0];
        if (!page) throw new Error(accountReviewCaptureFailureMessage);
        await withSignInPendingReview(
          page,
          accountLane.config.baseUrl,
          runCase
        );
      } else if (caseId === "account-magic-link-delivery") {
        await withCallbackHandoffReview(
          getOwnedPage(),
          accountLane.config.baseUrl,
          runCase
        );
      } else {
        await runCase();
      }

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
