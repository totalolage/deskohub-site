import "../../shared/polyfills/temporal";

import { equal, ok } from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { expect, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import type { DatabaseClient } from "@/db/database-client";
import {
  customerMarketingConsents,
  emailCampaignAudiences,
  emailCampaigns,
} from "@/db/schema";
import {
  createSyntheticCustomerProfile,
  expireSyntheticCustomerProfile,
  setSyntheticCustomerProfileTags,
} from "../account/fixtures";
import { getWorkspaceE2EMarketingDocumentHash } from "../account/marketing-document-hash";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import {
  type ActionResponseOutcome,
  openAdminSession,
  retainServerActionSubmission,
} from "../admin-case";
import {
  makeWorkspaceE2EAdministrationIdentities,
  type WorkspaceE2EAdministrationIdentities,
} from "../administrators/identities";
import type { E2EBrowserSession } from "../browser-session";
import { runE2ECase, type WorkspaceE2EStepRunner } from "../case-runner";
import { type DatasourceConfig, getDatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runtimeTest as test } from "../playwright-checkout/runtime-fixtures";
import { pollUntil, withinWorkspaceE2EDeadline } from "../polling";
import {
  waitForReactClickHandler,
  waitForReactSubmitHandler,
} from "../react-handlers";
import { addRedaction } from "../runtime";
import {
  workspaceE2EEmailCampaignCleanupTimeout,
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import { addDotyposTagCondition } from "./audience-filter-steps";
import {
  type EmailCampaignPreviewPlan,
  planEmailCampaignPreview,
  releaseEmailCampaignFixture,
} from "./email-campaign-case";

const emailCampaignPreviewCaseId = "email-campaign-recipient-preview";
const savedAudiencePath = /^\/en-US\/admin\/email-audiences\/(?!new$)[^/]+$/;
const savedCampaignPath = /^\/en-US\/admin\/email-campaigns\/(?!new$)[^/]+$/;
const recipientPreviewPath =
  /^\/en-US\/admin\/email-campaigns\/[^/]+\/recipients$/;

test("previews the tagged synthetic customer as a draft marketing campaign recipient", async ({
  baseURL,
  browser,
  environment,
  runContext,
  runEffect,
}) => {
  const identities = makeWorkspaceE2EAdministrationIdentities<"ecp-admin">({
    ownerId: emailCampaignPreviewCaseId,
    runId: runContext.runId,
    secret: resolveWorkspaceE2ESessionSigningSecret(environment),
  });
  addRedaction(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const datasourceConfig = getDatasourceConfig(environment);
  const plan = planEmailCampaignPreview();
  await runEffect(
    Effect.scoped(
      Effect.flatMap(
        openAdminSession({
          baseURL,
          browser,
          caseName: "email campaign recipient preview",
        }),
        ({ origin, session }) =>
          runEmailCampaignPreviewCase({
            bypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
            datasourceConfig,
            identities,
            origin,
            plan,
            reviewScreenshots:
              environment.WORKSPACE_E2E_CAMPAIGN_REVIEW_SCREENSHOTS === "true",
            session,
          })
      )
    )
  );
});

const runEmailCampaignPreviewCase = Effect.fn("runEmailCampaignPreviewCase")(
  function* (input: {
    readonly bypassSecret: string | undefined;
    readonly datasourceConfig: DatasourceConfig;
    readonly identities: WorkspaceE2EAdministrationIdentities<"ecp-admin">;
    readonly origin: string;
    readonly plan: EmailCampaignPreviewPlan;
    readonly reviewScreenshots: boolean;
    readonly session: E2EBrowserSession;
  }) {
    const { db } = yield* E2EDatabase;
    const { plan } = input;
    // Captured as soon as Dotypos returns it, so an interrupted setup still
    // retires the profile and removes its consent row.
    let customerId: DotyposCustomerId | undefined;
    let audienceId: string | undefined;
    // Registered before each submit click, so cleanup knows whether the action
    // was dispatched even when the submit step is interrupted.
    let audienceSubmission: Promise<ActionResponseOutcome> | undefined;
    let campaignSubmission: Promise<ActionResponseOutcome> | undefined;

    // Submits a hydrated admin form once, retaining its Server Action
    // submission before the click. The submission stays pending until the
    // request is sent or cleanup closes the browser session.
    const submitAction = (
      page: Page,
      submitLabel: string,
      retain: (submission: Promise<ActionResponseOutcome>) => void
    ) => {
      retain(retainServerActionSubmission(page, input.origin));
      return page
        .getByRole("button", { exact: true, name: submitLabel })
        .click({ timeout: workspaceE2ETimeouts.browserAction });
    };

    const waitForPath = (page: Page, path: RegExp, timeoutMs: number) =>
      page.waitForURL((url) => path.test(url.pathname), {
        timeout: timeoutMs,
        waitUntil: "commit",
      });

    const rowsAppear = <A>(
      read: Effect.Effect<readonly A[], WorkspaceE2EError>,
      label: string
    ) =>
      pollUntil(
        read.pipe(Effect.map((rows) => (rows.length > 0 ? rows : undefined))),
        {
          initialIntervalMs: workspaceE2EPollInitialIntervalMs.database,
          intervalMs: workspaceE2EPollIntervalMs.datasource,
          label,
          timeoutMs: workspaceE2ETimeouts.datasource,
        }
      );

    const audienceForm = (page: Page) =>
      page.locator("form").filter({
        has: page.getByRole("button", { exact: true, name: "Create audience" }),
      });
    const composerForm = (page: Page) => page.locator("#campaign-composer");

    const caseBody = (step: WorkspaceE2EStepRunner) => {
      const browserStep = (
        stepId: string,
        timeoutMs: number,
        operation: string,
        run: (page: Page) => Promise<unknown>
      ) =>
        step({
          execute: input.session.use(operation, (page) =>
            run(page).then(() => undefined)
          ),
          id: stepId,
          timeoutMs,
        });

      return Effect.gen(function* () {
        yield* step({
          execute: Effect.gen(function* () {
            const createdId = yield* createSyntheticCustomerProfile(
              input.datasourceConfig,
              {
                email: plan.recipientEmail,
                firstName: plan.customerFirstName,
              }
            );
            customerId = createdId;
            addRedaction(createdId);
            yield* setSyntheticCustomerProfileTags(
              input.datasourceConfig,
              createdId,
              [plan.customerTag]
            );
          }),
          id: "create-tagged-customer",
          timeoutMs: workspaceE2ETimeouts.providerTransition,
        });
        yield* step({
          execute: Effect.gen(function* () {
            if (customerId === undefined) {
              return yield* workspaceE2EError(
                "No synthetic Dotypos customer is available for marketing consent",
                { operation: "grant synthetic marketing consent" }
              );
            }
            const documentHash = yield* Effect.try({
              catch: () =>
                workspaceE2EError(
                  "Read marketing communications document hash failed",
                  { operation: "read marketing communications document hash" }
                ),
              try: () => getWorkspaceE2EMarketingDocumentHash(),
            });
            yield* db
              .insert(customerMarketingConsents)
              .values({
                documentHash,
                dotyposCustomerId: customerId,
                grantedAt: Temporal.Now.instant(),
                locale: "cs-CZ",
                withdrawnAt: null,
              })
              .pipe(
                Effect.mapError((cause) =>
                  toWorkspaceE2EError(
                    "grant synthetic marketing consent",
                    cause
                  )
                )
              );
          }),
          id: "grant-marketing-consent",
          timeoutMs: workspaceE2ETimeouts.cleanupAction,
        });
        yield* step({
          execute: input.session.primePreviewAccess(
            input.origin,
            input.bypassSecret,
            { timeoutMs: workspaceE2ETimeouts.browserAction }
          ),
          id: "prime-preview-bypass",
          timeoutMs: workspaceE2ETimeouts.browserAction,
        });
        yield* step({
          execute: Effect.gen(function* () {
            const administrator = yield* input.identities.seed("ecp-admin", [
              "administrator",
            ]);
            yield* input.identities.signIn(administrator, input);
          }).pipe(Effect.provideService(E2EDatabase, E2EDatabase.of({ db }))),
          id: "sign-in-seeded-administrator",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* browserStep(
          "open-audience-form",
          workspaceE2ETimeouts.browserNavigation,
          "open the new audience admin page",
          (page) =>
            page.goto(`${input.origin}/en-US/admin/email-audiences/new`, {
              timeout: workspaceE2ETimeouts.browserNavigation,
            })
        );
        yield* browserStep(
          "wait-for-audience-form-hydration",
          workspaceE2ETimeouts.uiTransition,
          "wait for the hydrated audience form",
          (page) =>
            waitForReactSubmitHandler(
              page,
              audienceForm(page),
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* browserStep(
          "fill-audience-form",
          workspaceE2ETimeouts.browserAction,
          "fill the audience title and synthetic Dotypos tags condition",
          async (page) => {
            await audienceForm(page)
              .getByLabel("Title", { exact: true })
              .fill(plan.audienceTitle, {
                timeout: workspaceE2ETimeouts.browserAction,
              });
            await addDotyposTagCondition(
              page,
              audienceForm(page),
              plan.customerTag
            );
          }
        );
        yield* browserStep(
          "submit-audience",
          workspaceE2ETimeouts.browserAction,
          "activate the create audience submit control once",
          (page) =>
            submitAction(page, "Create audience", (submission) => {
              audienceSubmission = submission;
            })
        );
        yield* browserStep(
          "wait-for-saved-audience",
          workspaceE2ETimeouts.uiTransition,
          "wait for the saved audience page",
          (page) =>
            waitForPath(
              page,
              savedAudiencePath,
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* step({
          execute: Effect.gen(function* () {
            const [audience] = yield* rowsAppear(
              readSyntheticAudiences(db, plan),
              "the synthetic email campaign audience"
            );
            ok(audience, "the saved audience must be persisted");
            const { filter } = audience;
            ok(
              filter._tag === "Group" &&
                filter.filters.some(
                  (condition) =>
                    condition._tag === "Condition" &&
                    condition.attribute === "dotyposTags" &&
                    condition.value[0] === plan.customerTag
                ),
              "the saved audience must target the synthetic Dotypos tag"
            );
            audienceId = audience.id;
          }),
          id: "assert-audience-persistence",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* browserStep(
          "open-campaign-composer",
          workspaceE2ETimeouts.browserNavigation,
          "open the new campaign admin page",
          (page) =>
            page.goto(`${input.origin}/en-US/admin/email-campaigns/new`, {
              timeout: workspaceE2ETimeouts.browserNavigation,
            })
        );
        if (input.reviewScreenshots) {
          const screenshotDirectory = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../../e2e-artifacts/account-review"
          );
          yield* browserStep(
            "open-campaign-composer-czech",
            workspaceE2ETimeouts.browserNavigation,
            "open the Czech campaign composer for review screenshots",
            (page) =>
              page.goto(`${input.origin}/cs-CZ/admin/email-campaigns/new`, {
                timeout: workspaceE2ETimeouts.browserNavigation,
              })
          );
          yield* browserStep(
            "verify-campaign-composer-render",
            workspaceE2ETimeouts.uiTransition,
            "wait for the Czech campaign action and preview before capturing",
            async (page) => {
              const actionButton = page.locator(
                'button[form="campaign-composer"]'
              );
              const preview = page.locator("#main-content .grid > aside");
              await expect(actionButton).toBeVisible();
              await expect(preview).toBeVisible();
            }
          );
          yield* browserStep(
            "capture-sticky-campaign-desktop",
            workspaceE2ETimeouts.browserNavigation,
            "capture the scrolled desktop campaign composer",
            async (page) => {
              await page.setViewportSize({ width: 1896, height: 1212 });
              await page.evaluate(() =>
                window.scrollTo({
                  behavior: "instant",
                  top: document.documentElement.scrollHeight,
                })
              );
              await mkdir(screenshotDirectory, { recursive: true });
              await page.screenshot({
                path: resolve(
                  screenshotDirectory,
                  "email-campaign-composer-sticky-desktop.png"
                ),
              });
            }
          );
          yield* browserStep(
            "capture-sticky-campaign-mobile",
            workspaceE2ETimeouts.browserNavigation,
            "capture the scrolled mobile campaign composer",
            async (page) => {
              await page.setViewportSize({ width: 390, height: 844 });
              await page.evaluate(() =>
                window.scrollTo({
                  behavior: "instant",
                  top: document.documentElement.scrollHeight,
                })
              );
              await page.screenshot({
                path: resolve(
                  screenshotDirectory,
                  "email-campaign-composer-sticky-mobile.png"
                ),
              });
            }
          );
          yield* browserStep(
            "restore-campaign-composer-english",
            workspaceE2ETimeouts.browserNavigation,
            "return to the English campaign composer",
            async (page) => {
              await page.setViewportSize({ width: 1440, height: 900 });
              await page.goto(
                `${input.origin}/en-US/admin/email-campaigns/new`,
                { timeout: workspaceE2ETimeouts.browserNavigation }
              );
            }
          );
        }
        yield* browserStep(
          "wait-for-composer-hydration",
          workspaceE2ETimeouts.uiTransition,
          "wait for the hydrated campaign composer",
          (page) =>
            waitForReactSubmitHandler(
              page,
              composerForm(page),
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* browserStep(
          "fill-campaign-form",
          workspaceE2ETimeouts.browserAction,
          "fill the campaign title, audience, and Czech content",
          async (page) => {
            await composerForm(page)
              .getByLabel("Title")
              .fill(plan.campaignTitle, {
                timeout: workspaceE2ETimeouts.browserAction,
              });
            await composerForm(page)
              .getByRole("combobox", { exact: true, name: "Audience" })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
            await page
              .getByRole("option", { exact: true, name: plan.audienceTitle })
              .click({ timeout: workspaceE2ETimeouts.browserAction });
            await composerForm(page)
              .getByRole("tabpanel")
              .getByLabel("Subject", { exact: true })
              .fill(plan.subject, {
                timeout: workspaceE2ETimeouts.browserAction,
              });
            const body = page.locator("#campaign-body-cs-CZ");
            await body.click({ timeout: workspaceE2ETimeouts.browserAction });
            await body.pressSequentially(plan.body, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
          }
        );
        yield* browserStep(
          "submit-campaign-draft",
          workspaceE2ETimeouts.browserAction,
          "activate the create draft control once",
          (page) =>
            submitAction(page, "Create draft", (submission) => {
              campaignSubmission = submission;
            })
        );
        yield* browserStep(
          "wait-for-saved-draft",
          workspaceE2ETimeouts.uiTransition,
          "wait for the saved campaign draft page",
          (page) =>
            waitForPath(
              page,
              savedCampaignPath,
              workspaceE2ETimeouts.uiTransition
            )
        );
        yield* step({
          execute: Effect.gen(function* () {
            const [campaign] = yield* rowsAppear(
              readSyntheticCampaigns(db, plan),
              "the synthetic email campaign draft"
            );
            ok(campaign, "the campaign draft must be persisted");
            equal(campaign.status, "draft");
            equal(campaign.purpose, "marketing");
            equal(campaign.audienceId, audienceId);
            equal(campaign.content["cs-CZ"]?.subject, plan.subject);
          }),
          id: "assert-campaign-persistence",
          timeoutMs: workspaceE2ETimeouts.datasource,
        });
        yield* browserStep(
          "open-recipient-preview",
          workspaceE2ETimeouts.uiTransition,
          "open the recipient preview",
          async (page) => {
            const link = page.getByRole("link", {
              exact: true,
              name: "Preview recipients",
            });
            await waitForReactClickHandler(page, link);
            await link.click({ timeout: workspaceE2ETimeouts.browserAction });
            await waitForPath(
              page,
              recipientPreviewPath,
              workspaceE2ETimeouts.uiTransition
            );
          }
        );
        yield* browserStep(
          "assert-tagged-recipient",
          workspaceE2ETimeouts.providerTransition,
          "assert the tagged synthetic customer is the only recipient",
          async (page) => {
            const recipients = page.getByRole("table", { name: "Recipients" });
            await expect(
              recipients.getByRole("cell", {
                exact: true,
                name: plan.recipientEmail,
              })
            ).toBeVisible({ timeout: workspaceE2ETimeouts.providerTransition });
            await expect(recipients.locator("tbody tr")).toHaveCount(1, {
              timeout: workspaceE2ETimeouts.browserAction,
            });
          }
        );
      });
    };

    const releaseSyntheticRows = Effect.suspend(() =>
      releaseEmailCampaignFixture({
        audiencePersisted: rowsAppear(
          readSyntheticAudiences(db, plan),
          "the synthetic audience before cleanup"
        ).pipe(Effect.as(true)),
        audienceSubmission,
        barrierTimeoutMs: workspaceE2ETimeouts.uiTransition,
        campaignPersisted: rowsAppear(
          readSyntheticCampaigns(db, plan),
          "the synthetic campaign draft before cleanup"
        ).pipe(Effect.as(true)),
        campaignSubmission,
        closeBrowser: withinWorkspaceE2EDeadline(
          input.session.close(),
          `${emailCampaignPreviewCaseId}/close-browser`,
          workspaceE2ETimeouts.browserAction
        ),
        deleteRows: deleteSyntheticRows(db, plan, customerId),
      })
    );
    const retireSyntheticCustomer = Effect.suspend(() =>
      customerId === undefined
        ? Effect.void
        : expireSyntheticCustomerProfile(input.datasourceConfig, customerId, {
            clearTags: true,
          })
    );

    yield* runE2ECase({
      body: caseBody,
      caseId: emailCampaignPreviewCaseId,
      cleanup: withinWorkspaceE2EDeadline(
        releaseSyntheticRows.pipe(
          Effect.ensuring(retireSyntheticCustomer.pipe(Effect.orDie))
        ),
        `${emailCampaignPreviewCaseId}/cleanup`,
        workspaceE2EEmailCampaignCleanupTimeout
      ).pipe(Effect.orDie),
      watchdogMs: workspaceE2ETimeouts.emailCampaignCase,
    });
  }
);

const readSyntheticAudiences = (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan
) =>
  db
    .select()
    .from(emailCampaignAudiences)
    .where(eq(emailCampaignAudiences.title, plan.audienceTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read synthetic email campaign audiences", cause)
      )
    );

const readSyntheticCampaigns = (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan
) =>
  db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.title, plan.campaignTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read synthetic email campaigns", cause)
      )
    );

/**
 * Deletes the run's campaign before its audience (a draft keeps the audience
 * referenced), then the synthetic consent row, and proves none remain.
 */
const deleteSyntheticRows = Effect.fn("deleteSyntheticRows")(function* (
  db: DatabaseClient,
  plan: EmailCampaignPreviewPlan,
  customerId: DotyposCustomerId | undefined
) {
  yield* db
    .delete(emailCampaigns)
    .where(eq(emailCampaigns.title, plan.campaignTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("delete synthetic email campaigns", cause)
      )
    );
  yield* db
    .delete(emailCampaignAudiences)
    .where(eq(emailCampaignAudiences.title, plan.audienceTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("delete synthetic email campaign audiences", cause)
      )
    );
  if (customerId !== undefined) {
    yield* db
      .delete(customerMarketingConsents)
      .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError("delete synthetic marketing consent", cause)
        )
      );
    const remainingConsents = yield* db
      .select({ id: customerMarketingConsents.dotyposCustomerId })
      .from(customerMarketingConsents)
      .where(eq(customerMarketingConsents.dotyposCustomerId, customerId))
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError(
            "verify synthetic marketing consent cleanup",
            cause
          )
        )
      );
    equal(remainingConsents.length, 0);
  }
  equal((yield* readSyntheticCampaigns(db, plan)).length, 0);
  equal((yield* readSyntheticAudiences(db, plan)).length, 0);
});
