import "../../shared/polyfills/temporal";

import { resolve } from "node:path";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { m } from "@/features/i18n";
import { WorkspaceE2EError, workspaceE2EError } from "../errors";
import { writeWorkspaceE2EFailureAnnotation } from "../github-actions";
import type { E2EDatabase } from "../integrations/database.service";
import { workspaceE2EAccountCheckoutCaseIds } from "../playwright-checkout/case-catalog";
import { readWorkspaceE2ERunPlan } from "../playwright-checkout/run-plan";
import { runtimeTest } from "../playwright-checkout/runtime-fixtures";
import {
  makePlaywrightBrowserRunner,
  type Runner,
  workspaceDir,
} from "../runtime";
import { WorkspaceE2ECaseService } from "../services/cases";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStep } from "../types";
import { verifyAccountLayoutNavigation } from "./account-layout-navigation";
import {
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
} from "./auth-rows";
import { withCallbackHandoffReview } from "./callback-handoff";
import { workspaceE2EAccountCaseIds } from "./catalog";
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
import { verifyWorkspaceE2EMarketingPreferences } from "./marketing-preferences";
import { verifyProfileNavigation } from "./profile-navigation";
import { makeMagicLinkRateBudget } from "./rate-budget";
import {
  verifyReferralInvitationReview,
  verifyReferralOverview,
} from "./referral-review";
import { withWorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";
import {
  toWorkspaceE2EReservationHistoryFailure,
  verifyWorkspaceE2EReservationHistoryNavigation,
} from "./reservation-navigation";
import {
  captureAccountReview,
  captureReservationStatusReview,
  withSignInPendingReview,
} from "./review-screenshots";
import {
  accountReviewTargetByCaseId,
  accountReviewTargetBySection,
  mobileAccountReviewTargetBySection,
} from "./review-targets";
import type { WorkspaceE2EAccountLifecycleHandoff } from "./types";
import {
  resolveWorkspaceE2EPreviewLogs,
  type WorkspaceE2EPreviewLogs,
} from "./vercel-log-retrieval";

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
  readonly previewLogs: WorkspaceE2EPreviewLogs;
  readonly journalRef: {
    readonly journal: WorkspaceE2EAccountJournal;
    readonly record: (update: {
      readonly authUserIds: readonly string[];
      readonly dotyposCustomerIds: readonly string[];
      readonly dotyposReservationIds: readonly string[];
    }) => Promise<void>;
  };
  readonly rateBudget: ReturnType<typeof makeMagicLinkRateBudget>;
  readonly runPlan: Awaited<ReturnType<typeof readWorkspaceE2ERunPlan>>;
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
    async ({ browser, environment, runContext, runEffect }, applyFixture) => {
      const config = getAccountE2EConfig(environment, runContext.runId);
      const runPlan = await readWorkspaceE2ERunPlan();
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
        await runEffect(
          Effect.scoped(
            Effect.gen(function* () {
              const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(config);
              yield* Effect.promise(() =>
                applyFixture({
                  config,
                  lifecycleHandoff,
                  journalRef,
                  previewLogs,
                  rateBudget: makeMagicLinkRateBudget(),
                  runPlan,
                  run,
                  session: `workspace-account-e2e-${runContext.runId}`,
                })
              );
            })
          )
        );
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
        previewLogs: accountLane.previewLogs,
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
      let verifyPages:
        | readonly WorkspaceE2EStep<void, E2EDatabase>[]
        | undefined;
      if (caseId === "account-profile-completion") {
        verifyPages = [
          {
            execute: Effect.tryPromise({
              catch: (cause) =>
                cause instanceof WorkspaceE2EError
                  ? cause
                  : workspaceE2EError(
                      "verify profile navigation and unsaved changes failed",
                      {
                        operation:
                          "verify profile navigation and unsaved changes",
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
          },
        ];
      } else if (caseId === "account-reservation-transitions") {
        const readAccountReservationCustomerId = Effect.fn(
          "readAccountReservationCustomerId"
        )(function* () {
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
          return customerId;
        });

        verifyPages = [
          {
            execute: Effect.gen(function* () {
              const page = getOwnedPage();
              yield* Effect.tryPromise({
                catch: (cause) =>
                  cause instanceof WorkspaceE2EError
                    ? cause
                    : workspaceE2EError(
                        "verify account layout navigation failed",
                        {
                          operation: "verify account layout navigation",
                        }
                      ),
                try: () =>
                  verifyAccountLayoutNavigation(page, async (section) => {
                    if (section === "referrals") {
                      await page
                        .getByText(
                          m.accountReferralsEligibleInvitees(
                            { count: "0" },
                            { locale: "en-US" }
                          ),
                          { exact: true }
                        )
                        .waitFor({
                          state: "visible",
                          timeout: workspaceE2ETimeouts.browserAction,
                        });
                    }
                    await captureAccountReview(
                      page,
                      accountLane.config.baseUrl,
                      accountReviewTargetBySection[section]
                    );
                    const mobileTarget =
                      mobileAccountReviewTargetBySection[section];
                    if (mobileTarget) {
                      await captureAccountReview(
                        page,
                        accountLane.config.baseUrl,
                        mobileTarget
                      );
                    }
                  }),
              });
            }),
            id: "checks account layout navigation",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
          {
            execute: Effect.tryPromise({
              catch: (cause) =>
                cause instanceof WorkspaceE2EError
                  ? cause
                  : workspaceE2EError(
                      "capture Czech zero-invite referral overview failed",
                      { operation: "capture Czech referral overview" }
                    ),
              try: () =>
                verifyReferralOverview({
                  baseUrl: accountLane.config.baseUrl,
                  count: 0,
                  locale: "cs-CZ",
                  page: getOwnedPage(),
                  targets: {
                    desktop: "linked-referrals-cs-desktop",
                    mobile: "linked-referrals-cs-mobile",
                  },
                }),
            }),
            id: "captures zero-invite referral overview in Czech",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
          {
            execute: Effect.gen(function* () {
              const customerId = yield* readAccountReservationCustomerId();
              yield* verifyWorkspaceE2EMarketingPreferences({
                baseUrl: accountLane.config.baseUrl,
                browser,
                bypassSecret: accountLane.config.bypassSecret,
                customerId: DotyposCustomerIdSchema.make(customerId),
                page: getOwnedPage(),
              });
            }),
            id: "checks account marketing preferences",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
          {
            execute: Effect.gen(function* () {
              const customerId = yield* readAccountReservationCustomerId();
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
          },
        ];
      } else if (caseId === "account-referrals") {
        verifyPages = [
          {
            execute: Effect.tryPromise({
              catch: (cause) =>
                cause instanceof WorkspaceE2EError
                  ? cause
                  : workspaceE2EError(
                      "capture referral overview and invitation states failed",
                      { operation: "capture referral review states" }
                    ),
              try: async () => {
                const page = getOwnedPage();
                const baseUrl = accountLane.config.baseUrl;
                await verifyReferralOverview({
                  baseUrl,
                  count: 1,
                  locale: "en-US",
                  page,
                  targets: {
                    desktop: "referral-overview-positive-desktop",
                    mobile: "referral-overview-positive-mobile",
                  },
                });
                await verifyReferralOverview({
                  baseUrl,
                  count: 1,
                  locale: "cs-CZ",
                  page,
                  targets: {
                    desktop: "referral-overview-positive-cs-desktop",
                    mobile: "referral-overview-positive-cs-mobile",
                  },
                });

                const invitationCode =
                  accountLane.lifecycleHandoff.referralInvitationCode;
                const unavailableCode =
                  accountLane.lifecycleHandoff.referralUnavailableCode;
                if (!invitationCode || !unavailableCode) {
                  throw workspaceE2EError(
                    "referral invitation fixture is incomplete",
                    {
                      diagnosticCode:
                        "postgres_account_fixture_assertion_failed",
                      operation: "read referral invitation handoff",
                    }
                  );
                }
                await verifyReferralInvitationReview({
                  baseUrl,
                  invitationCode,
                  page,
                  unavailableCode,
                });
              },
            }),
            id: "captures eligible accepted and unavailable referral states",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
        ];
      }
      const runCase = () =>
        runEffect(
          runWorkspaceE2EAccountCase({
            journalRef: accountLane.journalRef,
            reportFailure: writeWorkspaceE2EFailureAnnotation,
            session: accountLane.session,
            testCase: selected,
            ...(verifyPages ? { verifyPages } : {}),
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

  if (caseId === "account-referrals") {
    accountTest(
      workspaceE2EAccountCheckoutCaseIds[0],
      async ({ accountLane, browser, environment, runEffect }) => {
        const contact = accountLane.lifecycleHandoff.referralCheckoutContact;
        const referralCode =
          accountLane.lifecycleHandoff.referralInvitationCode;
        if (!contact || !referralCode) {
          throw new Error("account referral checkout handoff is incomplete");
        }

        const { getConfig, getDatasourceConfig } = await import("../config");
        const { writeWorkspaceE2ECaseJournal } = await import(
          "../playwright-checkout/run-plan"
        );
        const config = getConfig(environment);
        const datasourceConfig = getDatasourceConfig(environment);
        const caseId = workspaceE2EAccountCheckoutCaseIds[0];
        const plannedCase = await runEffect(
          Effect.gen(function* () {
            const caseService = yield* WorkspaceE2ECaseService;
            const cases = yield* caseService.reconstructCases({
              allocation: accountLane.runPlan.runContext.allocation,
              config,
              datasourceConfig,
              flowStates: [],
              preparation: accountLane.runPlan.preparation,
              run: accountLane.run,
            });
            return cases.find((candidate) => candidate.id === caseId);
          })
        );
        if (!plannedCase) {
          throw new Error("planned account referral checkout was not built");
        }

        const { bindWorkspaceE2EAccountReferralCheckout } = await import(
          "./referral-checkout"
        );
        const { captureReferralCheckoutReview } = await import(
          "./referral-checkout-review"
        );
        const pages = browser.contexts().flatMap((context) => context.pages());
        const page = pages.length === 1 ? pages[0] : undefined;
        if (!page) throw new Error(accountReviewCaptureFailureMessage);
        const boundCase = bindWorkspaceE2EAccountReferralCheckout({
          captureReview: ({ expectedPayUrl, orderId, target }) =>
            captureReferralCheckoutReview({
              baseUrl: config.baseUrl,
              expectedPayUrl,
              orderId,
              page,
              target,
            }),
          config,
          contact: {
            ...contact,
            customerId: DotyposCustomerIdSchema.make(contact.customerId),
          },
          datasourceConfig,
          referralCode,
          run: accountLane.run,
          testCase: plannedCase,
        });

        const journalStartedAt = new Date();
        await writeWorkspaceE2ECaseJournal(
          caseId,
          boundCase.checkoutStates,
          journalStartedAt
        );
        try {
          await runEffect(
            Effect.gen(function* () {
              const caseService = yield* WorkspaceE2ECaseService;
              yield* caseService.runCase({
                artifactRoot: resolve(
                  workspaceDir,
                  "e2e-artifacts",
                  "checkout",
                  "cases"
                ),
                browserSession: {
                  ownership: "borrowed",
                  session: accountLane.session,
                },
                datasourceConfig,
                run: accountLane.run,
                sessionPrefix: `workspace-checkout-e2e-${accountLane.runPlan.runContext.runId}`,
                testCase: boundCase,
                timeouts: config.timeouts,
              });
            })
          );
        } finally {
          await writeWorkspaceE2ECaseJournal(
            caseId,
            boundCase.checkoutStates,
            journalStartedAt
          );
        }
      }
    );
  }
}
