import "../../shared/polyfills/temporal";

import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { Browser } from "@playwright/test";
import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import type { WorkspaceE2EStep } from "../case-runner";
import { WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import { readWorkspaceE2ERunPlan } from "../playwright-checkout/run-plan";
import { runtimeTest } from "../playwright-checkout/runtime-fixtures";
import { makePlaywrightBrowserRunner, type Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { verifyAccountLayoutNavigation } from "./account-layout-navigation";
import {
  findAuthUserIdByEmail,
  findLinkedDotyposCustomerId,
} from "./auth-rows";
import { withCallbackHandoffReview } from "./callback-handoff";
import type { WorkspaceE2ESignInReturns } from "./cases";
import {
  type WorkspaceE2EAccountCaseId,
  workspaceE2EAccountCaseIds,
  workspaceE2EAccountCaseSkipReason,
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
import { verifyAccountLocaleSwitchTransition } from "./locale-switch-transition";
import { verifyWorkspaceE2EMarketingPreferences } from "./marketing-preferences";
import {
  makeWorkspaceE2EAccountPasskeys,
  type WorkspaceE2EAccountPasskeys,
} from "./passkeys";
import { workspaceE2EAccountProfileName } from "./profile-fixture";
import { verifyProfileNavigation } from "./profile-navigation";
import { makeMagicLinkRateBudget } from "./rate-budget";
import { waitForReferralStats } from "./referral-review";
import { verifyReservationExistingCustomer } from "./reservation-existing-customer";
import { withWorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";
import {
  toWorkspaceE2EReservationHistoryFailure,
  verifyWorkspaceE2EReservationHistoryNavigation,
} from "./reservation-navigation";
import {
  type AccountReviewDestination,
  captureAccountReview,
  captureReservationStatusReview,
  type LanguagePreferenceReviewCapture,
  withLanguagePreferenceReview,
  withSignInPendingReview,
} from "./review-screenshots";
import {
  accountReviewTargetByCaseId,
  accountReviewTargetBySection,
  mobileAccountReviewTargetBySection,
  reservationCustomerReviewTargetByMode,
  type SignInHandoffReviewStage,
  signInHandoffReviewTargetByStage,
} from "./review-targets";
import type { WorkspaceE2EAccountLifecycleHandoff } from "./types";
import {
  resolveWorkspaceE2EPreviewLogs,
  type WorkspaceE2EPreviewLogs,
} from "./vercel-log-retrieval";

const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

/**
 * Captures a review moment of the cross-browser sign-in in the assistant's
 * browser. It runs beside the lane page, so the one page on the handoff
 * locale's auth routes is the assistant's: the lane page is then on an
 * English page or the cowork selection.
 */
const captureSignInHandoffReview = async (
  browser: Browser,
  destination: AccountReviewDestination,
  locale: Locale,
  stage: SignInHandoffReviewStage
): Promise<void> => {
  if (!destination.screenshots) return;
  const pages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => {
      try {
        return new URL(page.url()).pathname.startsWith(`/${locale}/auth/`);
      } catch {
        return false;
      }
    });
  const page = pages.length === 1 ? pages[0] : undefined;
  if (!page) throw new Error(accountReviewCaptureFailureMessage);
  await captureAccountReview(
    page,
    destination,
    signInHandoffReviewTargetByStage[stage]
  );
};

type WorkspaceE2EAccountLane = {
  readonly config: ReturnType<typeof getAccountE2EConfig>;
  /**
   * The one mutable lifecycle handoff for the whole worker. The case factory
   * runs again for every Playwright test, so this object must outlive it;
   * it stays in memory only and never joins the cleanup journal.
   */
  readonly lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff;
  /**
   * The passkey journeys on the lane page, owned by the worker so their
   * virtual authenticator spans the cases that add, use, and remove it.
   */
  readonly passkeys: WorkspaceE2EAccountPasskeys;
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
  /**
   * The selections the lane's sign-ins return to, built once per worker so
   * the case that requests a link and the case that consumes it agree.
   */
  readonly signInReturns: WorkspaceE2ESignInReturns;
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
      const { makeWorkspaceE2ESignInReturns } = await import("./cases");
      const signInReturns = makeWorkspaceE2ESignInReturns();
      const passkeys = makeWorkspaceE2EAccountPasskeys({
        baseUrl: config.baseUrl,
        getPage: () => {
          const pages = browser
            .contexts()
            .flatMap((context) => context.pages());
          const page = pages.length === 1 ? pages[0] : undefined;
          if (!page) throw new Error("The account lane has no single page");
          return page;
        },
        locale: config.locale,
      });
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
                  passkeys,
                  previewLogs,
                  rateBudget: makeMagicLinkRateBudget(),
                  runPlan,
                  run,
                  session: `workspace-account-e2e-${runContext.runId}`,
                  signInReturns,
                })
              );
            })
          )
        );
      } finally {
        // A failed passkey case leaves its authenticator behind; the lane
        // page closes with the session either way.
        await runEffect(Effect.ignore(passkeys.removeAuthenticator));
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
      const { makeWorkspaceE2EAccountLaneBrowser } = await import(
        "./lane-browser"
      );
      const datasourceConfig = getDatasourceConfig(environment);
      // The language review wrapper hands its capture hook over only when it
      // starts the case, so the case reads it through this slot.
      let captureLanguagePreferenceReview:
        | LanguagePreferenceReviewCapture
        | undefined;
      const { signInReturns } = accountLane;
      const cases = makeWorkspaceE2EAccountCases({
        captureLanguagePreferenceReview: async (stage) => {
          await captureLanguagePreferenceReview?.(stage);
        },
        captureSignInHandoffReview: (stage) =>
          captureSignInHandoffReview(
            browser,
            accountLane.config.review,
            signInReturns.assistant.locale,
            stage
          ),
        config: accountLane.config,
        datasourceConfig,
        laneBrowser: makeWorkspaceE2EAccountLaneBrowser({
          config: accountLane.config,
          run: accountLane.run,
          session: accountLane.session,
        }),
        lifecycleHandoff: accountLane.lifecycleHandoff,
        passkeys: accountLane.passkeys,
        previewLogs: accountLane.previewLogs,
        rateBudget: accountLane.rateBudget,
        signInReturns,
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
            id: "verify-profile-navigation",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
          {
            execute: Effect.tryPromise({
              catch: (cause) =>
                cause instanceof WorkspaceE2EError
                  ? cause
                  : workspaceE2EError(
                      "verify reservation existing customer card failed",
                      {
                        operation: "verify reservation existing customer card",
                      }
                    ),
              try: async () => {
                const page = getOwnedPage();
                await verifyReservationExistingCustomer({
                  baseUrl: accountLane.config.baseUrl,
                  captureReview: (mode) =>
                    captureAccountReview(
                      page,
                      accountLane.config.review,
                      reservationCustomerReviewTargetByMode[mode]
                    ),
                  contact: {
                    email: makeWorkspaceE2EAccountRecipient(
                      accountLane.config,
                      workspaceE2EAccountMainRecipientLabel
                    ),
                    name: workspaceE2EAccountProfileName,
                  },
                  page,
                  reviewScreenshots: accountLane.config.review.screenshots,
                });
              },
            }),
            id: "verify-reservation-existing-customer-card",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
        ];
      } else if (caseId === "account-locale-preference") {
        verifyPages = [
          {
            execute: Effect.tryPromise({
              catch: (cause) =>
                cause instanceof WorkspaceE2EError
                  ? cause
                  : workspaceE2EError("verify account locale switch failed", {
                      operation: "verify account locale switch",
                    }),
              try: () =>
                verifyAccountLocaleSwitchTransition(
                  getOwnedPage(),
                  accountLane.config.baseUrl
                ),
            }),
            id: "switch-profile-locale",
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
                  verifyAccountLayoutNavigation(
                    page,
                    async (section) => {
                      if (section === "referrals") {
                        await waitForReferralStats({
                          count: 0,
                          locale: "en-US",
                          page,
                        });
                      }
                      await captureAccountReview(
                        page,
                        accountLane.config.review,
                        accountReviewTargetBySection[section]
                      );
                      const mobileTarget =
                        mobileAccountReviewTargetBySection[section];
                      if (mobileTarget) {
                        await captureAccountReview(
                          page,
                          accountLane.config.review,
                          mobileTarget
                        );
                      }
                    },
                    accountLane.config.review
                  ),
              });
            }),
            id: "verify-account-layout-navigation",
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
                reviewScreenshots: accountLane.config.review.screenshots,
              });
            }),
            id: "verify-account-marketing-preferences",
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
                            accountLane.config.review,
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
            id: "verify-reservation-history-navigation",
            timeoutMs: workspaceE2ETimeouts.providerTransition,
          },
        ];
      }
      const runCase = () =>
        runEffect(
          runWorkspaceE2EAccountCase({
            journalRef: accountLane.journalRef,
            session: accountLane.session,
            testCase: selected,
            ...(verifyPages ? { verifyPages } : {}),
          })
        );

      const skipReason = workspaceE2EAccountCaseSkipReason(
        caseId,
        accountLane.lifecycleHandoff
      );
      accountTest.skip(skipReason !== undefined, skipReason);

      if (caseId === "account-sign-in-form") {
        const pages = browser.contexts().flatMap((context) => context.pages());
        if (pages.length !== 1)
          throw new Error(accountReviewCaptureFailureMessage);
        const page = pages[0];
        if (!page) throw new Error(accountReviewCaptureFailureMessage);
        await withSignInPendingReview(page, accountLane.config.review, runCase);
      } else if (caseId === "account-magic-link-delivery") {
        // The link the lane tab requested from its cowork selection returns
        // there, so its callback shows the returning signed-in copy first.
        await withCallbackHandoffReview(
          getOwnedPage(),
          accountLane.config.review,
          runCase,
          {
            locale: signInReturns.sameBrowser.locale,
            returnTo: signInReturns.sameBrowser.returnTo,
            reviewTarget: "callback-signed-in-desktop",
          }
        );
      } else if (caseId === "account-deletion-and-reactivation") {
        // The lane browser opens the link the assistant's browser requested,
        // so its callback shows the signed-in copy before it leaves for the
        // selection; the hold proves that on every pass.
        await withCallbackHandoffReview(
          getOwnedPage(),
          accountLane.config.review,
          runCase,
          {
            locale: signInReturns.assistant.locale,
            returnTo: signInReturns.assistant.returnTo,
            reviewTarget: "callback-signed-in-cs-desktop",
          }
        );
      } else if (caseId === "account-locale-preference") {
        await withLanguagePreferenceReview(
          getOwnedPage(),
          accountLane.config.review,
          (capture) => {
            captureLanguagePreferenceReview = capture;
            return runCase();
          }
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
        await captureAccountReview(page, accountLane.config.review, target);
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
          await captureAccountReview(
            page,
            accountLane.config.review,
            "deleted-desktop"
          );
        }
      );
    }
  );
}
