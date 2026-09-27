import "../../shared/polyfills/temporal";

import { readFile } from "node:fs/promises";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { unzipSync } from "fflate";
import { WorkspaceE2EError, workspaceE2EError } from "../errors";
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
import { workspaceE2EAccountCaseIds } from "./catalog";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
  workspaceE2EAccountMainRecipientLabel,
} from "./config";
import {
  accountDataExportActionMessage,
  accountDataExportDeliveredStatusMessage,
} from "./export-status";
import {
  emptyWorkspaceE2EAccountJournal,
  type WorkspaceE2EAccountJournal,
  writeWorkspaceE2EAccountJournal,
} from "./journal";
import { verifyWorkspaceE2EMarketingPreferences } from "./marketing-preferences";
import { verifyProfileNavigation } from "./profile-navigation";
import { makeMagicLinkRateBudget } from "./rate-budget";
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

const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

/**
 * The attachment filename the export route announces through
 * Content-Disposition and the component forwards to the browser download.
 * Only the date stamp varies, so the shape pins the contract.
 */
const accountDataExportFilenamePattern =
  /^deskohub-account-data-\d{4}-\d{2}-\d{2}\.zip$/;

/** The exact allowlisted entry set of the export archive, in catalog order. */
const accountDataExportExpectedEntries = [
  "manifest.json",
  "identity.json",
  "dotypos-profile.json",
  "reservation-history.json",
  "workspace-reservations.json",
  "payments.json",
  "discount-applications.json",
  "invoices.json",
  "consents.json",
  "access-grants.json",
] as const;

/**
 * A deliberately raised lane assertion, distinguishable from an accidental
 * TypeError so the download guard can re-raise these untouched while
 * converting every other failure into the fixed malformed-download error.
 */
class AccountDataExportLaneAssertion extends Error {}

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
      let verifyPages:
        | readonly WorkspaceE2EStep<void, E2EDatabase>[]
        | undefined;
      if (caseId === "account-profile-completion") {
        verifyPages = [
          {
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

      if (caseId === "account-data-export") {
        const baseUrl = accountLane.config.baseUrl;
        const page = getOwnedPage();
        await accountTest.step(
          "capture account data export pending, delivered, and error states",
          async () => {
            await page.goto(
              new URL("/en-US/account/legal", baseUrl).toString(),
              {
                timeout: workspaceE2ETimeouts.browserNavigation,
              }
            );
            const exportButton = page.getByRole("button", {
              exact: true,
              name: accountDataExportActionMessage(),
            });
            await exportButton.waitFor({
              state: "visible",
              timeout: workspaceE2ETimeouts.browserAction,
            });

            // Pending and delivered share one deliberately delayed response.
            await page.route(
              "**/account/data-export",
              async (route) => {
                await new Promise((resolve) => setTimeout(resolve, 10_000));
                await route.continue();
              },
              { times: 1 }
            );
            // The delivered state must end in a real browser download, not
            // only a status message. The wait attaches before the click so
            // the event cannot slip past while the response is still delayed.
            const downloadPromise = page.waitForEvent("download", {
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await exportButton.click({
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await page
              .locator("#account-data-export[aria-busy='true']")
              .waitFor({
                state: "visible",
                timeout: workspaceE2ETimeouts.browserAction,
              });
            await captureAccountReview(
              page,
              baseUrl,
              "legal-export-pending-desktop"
            );
            await page
              .getByText(accountDataExportDeliveredStatusMessage(), {
                exact: true,
              })
              .waitFor({
                state: "visible",
                timeout: workspaceE2ETimeouts.browserAction,
              });
            await captureAccountReview(
              page,
              baseUrl,
              "legal-export-delivered-desktop"
            );

            // The browser download itself must complete with the expected
            // attachment name and an allowlisted archive. Only structural
            // facts are asserted; the archive entries never reach this output.
            const download = await downloadPromise;
            if ((await download.failure()) !== null) {
              throw new Error("the account data download did not complete");
            }
            if (
              !accountDataExportFilenamePattern.test(
                download.suggestedFilename()
              )
            ) {
              throw new Error(
                "the account data download carried an unexpected filename"
              );
            }
            const recipient = makeWorkspaceE2EAccountRecipient(
              accountLane.config,
              workspaceE2EAccountMainRecipientLabel
            );
            // Parsing and every derived value stay inside this guard so a
            // malformed body can only raise the fixed malformed-download
            // error; a native parse error or an accidental TypeError would
            // otherwise leak an archive excerpt to the reporter.
            try {
              const archive = unzipSync(
                new Uint8Array(await readFile(await download.path()))
              );
              const entryNames = Object.keys(archive).sort();
              if (
                entryNames.length !== accountDataExportExpectedEntries.length ||
                !accountDataExportExpectedEntries.every((entry) =>
                  entryNames.includes(entry)
                )
              ) {
                throw new AccountDataExportLaneAssertion(
                  "the downloaded export exposed entries outside the allowlist"
                );
              }
              const manifest = JSON.parse(
                new TextDecoder().decode(archive["manifest.json"]!)
              ) as {
                readonly schemaVersion: number;
                readonly sections: readonly { readonly path: string }[];
              };
              if (manifest.schemaVersion !== 2) {
                throw new AccountDataExportLaneAssertion(
                  "the downloaded export used an unexpected schema version"
                );
              }
              const sectionPaths = manifest.sections.map(
                (section) => section.path
              );
              if (
                sectionPaths.length !==
                  accountDataExportExpectedEntries.filter(
                    (entry) => entry !== "manifest.json"
                  ).length ||
                !accountDataExportExpectedEntries
                  .filter((entry) => entry !== "manifest.json")
                  .every((entry, index) => sectionPaths[index] === entry)
              ) {
                throw new AccountDataExportLaneAssertion(
                  "the downloaded export manifest drifted from the contractual sections"
                );
              }
              const identity = JSON.parse(
                new TextDecoder().decode(archive["identity.json"]!)
              ) as {
                readonly accountId: string;
                readonly email: string;
              };
              if (identity.email !== recipient) {
                throw new AccountDataExportLaneAssertion(
                  "the downloaded export identity did not match the synthetic recipient"
                );
              }
              if (
                !accountLane.journalRef.journal.authUserIds.includes(
                  identity.accountId
                )
              ) {
                throw new AccountDataExportLaneAssertion(
                  "the downloaded export identity was not the journaled synthetic account"
                );
              }
            } catch (error) {
              if (error instanceof AccountDataExportLaneAssertion) throw error;
              throw new Error(
                "the account data download was not the expected ZIP archive"
              );
            }

            // The error state must recover into a retryable idle control.
            await page.route(
              "**/account/data-export",
              (route) => route.abort(),
              { times: 1 }
            );
            await exportButton.click({
              timeout: workspaceE2ETimeouts.browserAction,
            });
            await page
              .getByText(
                "We could not prepare your account data download. Please try again.",
                { exact: true }
              )
              .waitFor({
                state: "visible",
                timeout: workspaceE2ETimeouts.browserAction,
              });
            await captureAccountReview(
              page,
              baseUrl,
              "legal-export-error-desktop"
            );
          }
        );
        return;
      }

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
