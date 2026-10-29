import "../../shared/polyfills/temporal";

import { deepEqual, equal, ok } from "node:assert/strict";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { type Browser, expect, type Page } from "@playwright/test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import type { DatabaseClient, RootDatabaseClient } from "@/db/database-client";
import {
  customerEvents,
  customerMarketingConsents,
  emailCampaignAudiences,
  emailCampaignAutomationPreviews,
  emailCampaignAutomationRuns,
  emailCampaignAutomations,
  emailCampaigns,
} from "@/db/schema";
import { deleteAutomatedCampaigns } from "@/features/email-campaigns/backend/email-campaigns.test-utils";
import { automationTickAtOrAfter } from "@/features/email-campaigns/automation/automation-ticks";
import {
  type CampaignId,
  campaignIdSchema,
} from "@/features/email-campaigns/campaign-identifiers";
import { setSyntheticCustomerProfileTags } from "../account/fixtures";
import { getWorkspaceE2EMarketingDocumentHash } from "../account/marketing-document-hash";
import { resolveWorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import {
  type ActionResponseOutcome,
  openAdminSession,
  retainServerActionSubmission,
} from "../admin-case";
import { makeWorkspaceE2EAdministrationIdentities } from "../administrators/identities";
import { bindWorkspaceE2ECheckoutBooker } from "../checkout/booker";
import { readCheckoutCleanupCustomerIds } from "../cleanup";
import {
  type DatasourceConfig,
  getConfig,
  getDatasourceConfig,
} from "../config";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2ECaseId } from "../playwright-checkout/case-catalog";
import type { WorkspaceE2ECaseBinder } from "../playwright-checkout/fixtures";
import { pollUntil, withinWorkspaceE2EDeadline } from "../polling";
import {
  waitForReactClickHandler,
  waitForReactSubmitHandler,
} from "../react-handlers";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { addRedaction } from "../runtime";
import {
  workspaceE2EAutomationJourneyCleanupTimeout,
  workspaceE2EPollInitialIntervalMs,
  workspaceE2EPollIntervalMs,
  workspaceE2ETimeouts,
} from "../timeouts";
import type { CheckoutData, WorkspaceE2ECase } from "../types";
import { addDotyposTagCondition } from "./audience-filter-steps";
import {
  type AutomationJourneyPlan,
  automationJourneyTitlePrefix,
  planAutomationJourney,
} from "./automation-journey-plan";
import {
  pollAutomationEngine,
  resolveWorkspaceE2ECronSecret,
  tickAutomationPlanner,
} from "./automation-planner";
import { releaseEmailCampaignFixture } from "./email-campaign-case";

export const automationReservationCaseId =
  "automation-reservation-booked" as const satisfies WorkspaceE2ECaseId;

const savedAudiencePath = /^\/en-US\/admin\/email-audiences\/(?!new$)[^/]+$/;
const savedCampaignPath = /^\/en-US\/admin\/email-campaigns\/(?!new$)[^/]+$/;

type CaseContext = Parameters<WorkspaceE2ECase["execute"]>[0];

/**
 * Builds an automated campaign in the admin UI (a tagged audience, a
 * reservation-booked trigger with a tag condition, and Czech content), dry
 * runs and activates it, books the case's zero-total reservation as its
 * seeded booker, tags that customer, and waits for the run to reach `sent`
 * in the database and the run log. Vercel Cron never fires on previews, so
 * every engine wait ticks the planner through its cron route.
 */
export const bindAutomationReservationCase: WorkspaceE2ECaseBinder = async (
  input
) => {
  const booked = await bindWorkspaceE2ECheckoutBooker(input);
  const [checkoutState] = booked.checkoutStates;
  if (!checkoutState || booked.checkoutStates.length !== 1) {
    throw new Error(`planned ${booked.id} checkout is incomplete`);
  }
  const { environment } = input;
  const config = getConfig(environment);
  const cronSecret = resolveWorkspaceE2ECronSecret(environment);
  const bypassSecret = environment.VERCEL_AUTOMATION_BYPASS_SECRET;
  addRedaction(bypassSecret);
  const journey = {
    book: booked.execute,
    browser: input.browser,
    bypassSecret,
    checkoutState,
    datasourceConfig: getDatasourceConfig(environment),
    identities: makeWorkspaceE2EAdministrationIdentities<"arb-admin">({
      ownerId: automationReservationCaseId,
      runId: input.runId,
      secret: resolveWorkspaceE2ESessionSigningSecret(environment),
    }),
    origin: config.baseUrl,
    plan: planAutomationJourney(input.runId),
    tickPlanner: tickAutomationPlanner({
      bypassSecret,
      cronSecret,
      origin: config.baseUrl,
      timeoutMs: workspaceE2ETimeouts.providerTransition,
    }),
  };
  return {
    ...booked,
    execute: (context) => runAutomationJourney(journey, context),
  };
};

const runAutomationJourney = Effect.fn("runAutomationJourney")(function* (
  journey: {
    readonly book: WorkspaceE2ECase["execute"];
    readonly browser: Browser;
    readonly bypassSecret: string | undefined;
    readonly checkoutState: WorkspaceE2ECase["checkoutStates"][number];
    readonly datasourceConfig: DatasourceConfig;
    readonly identities: ReturnType<
      typeof makeWorkspaceE2EAdministrationIdentities<"arb-admin">
    >;
    readonly origin: string;
    readonly plan: AutomationJourneyPlan;
    readonly tickPlanner: Effect.Effect<void, WorkspaceE2EError>;
  },
  context: CaseContext
) {
  const { db } = yield* E2EDatabase;
  const { plan } = journey;
  const { runStep } = context;
  const admin = yield* openAdminSession({
    baseURL: journey.origin,
    browser: journey.browser,
    caseName: "automation journey",
  });
  const origin = admin.origin;
  // Captured as soon as each is known, so an interrupted case still deletes
  // what it created.
  let campaignId: CampaignId | undefined;
  let customerId: DotyposCustomerId | undefined;
  // Registered before each creating submit, so cleanup knows whether the
  // action was dispatched even when its step is interrupted.
  let audienceSubmission: Promise<ActionResponseOutcome> | undefined;
  let campaignSubmission: Promise<ActionResponseOutcome> | undefined;

  const browserStep = (
    id: string,
    timeoutMs: number,
    operation: string,
    run: (page: Page) => Promise<unknown>
  ) =>
    runStep({
      execute: admin.session.use(operation, (page) =>
        run(page).then(() => undefined)
      ),
      id,
      timeoutMs,
    });

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

  const requireCampaignId = Effect.suspend(() =>
    campaignId === undefined
      ? workspaceE2EError("The automated campaign was not created", {
          operation: "read the automated campaign",
        })
      : Effect.succeed(campaignId)
  );

  const campaignPath = (suffix = "") =>
    `${origin}/en-US/admin/email-campaigns/${campaignId}${suffix}`;

  const audienceForm = (page: Page) =>
    page.locator("form").filter({
      has: page.getByRole("button", { exact: true, name: "Create audience" }),
    });
  const composerForm = (page: Page) => page.locator("#campaign-composer");
  // The composer's submit button sits in the page header, outside the form,
  // linked to it only by its form attribute.
  const composerSubmit = (page: Page, name: string) =>
    page
      .getByRole("button", { exact: true, name })
      .and(page.locator('[form="campaign-composer"]'));
  const flowForm = (page: Page) =>
    page.locator("form").filter({
      has: page.getByRole("button", { exact: true, name: "Save flow" }),
    });

  const body = Effect.gen(function* () {
    yield* runStep({
      execute: admin.session.primePreviewAccess(origin, journey.bypassSecret, {
        timeoutMs: workspaceE2ETimeouts.browserAction,
      }),
      id: "automation-prime-preview-bypass",
      timeoutMs: workspaceE2ETimeouts.browserAction,
    });
    yield* runStep({
      execute: Effect.gen(function* () {
        const administrator = yield* journey.identities.seed("arb-admin", [
          "administrator",
        ]);
        yield* journey.identities.signIn(administrator, {
          origin,
          session: admin.session,
        });
      }),
      id: "automation-sign-in-administrator",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });

    yield* browserStep(
      "automation-create-audience",
      workspaceE2ETimeouts.uiTransition * 2,
      "create the tagged automation audience",
      async (page) => {
        await page.goto(`${origin}/en-US/admin/email-audiences/new`, {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
        await waitForReactSubmitHandler(
          page,
          audienceForm(page),
          workspaceE2ETimeouts.uiTransition
        );
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
        audienceSubmission = retainServerActionSubmission(page, origin);
        await page
          .getByRole("button", { exact: true, name: "Create audience" })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        await waitForPath(
          page,
          savedAudiencePath,
          workspaceE2ETimeouts.uiTransition
        );
      }
    );

    yield* browserStep(
      "automation-create-campaign",
      workspaceE2ETimeouts.uiTransition * 2,
      "create the automated campaign draft",
      async (page) => {
        await page.goto(`${origin}/en-US/admin/email-campaigns/new`, {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
        await waitForReactSubmitHandler(
          page,
          composerForm(page),
          workspaceE2ETimeouts.uiTransition
        );
        await composerForm(page).getByLabel("Title").fill(plan.campaignTitle, {
          timeout: workspaceE2ETimeouts.browserAction,
        });
        await composerForm(page)
          .getByRole("radio", { name: /^Automated\b/ })
          .check({ timeout: workspaceE2ETimeouts.browserAction });
        await composerForm(page)
          .getByRole("combobox", { name: /^Audience\b/ })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        await page
          .getByRole("option", { exact: true, name: plan.audienceTitle })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        campaignSubmission = retainServerActionSubmission(page, origin);
        await composerSubmit(page, "Create draft").click({
          timeout: workspaceE2ETimeouts.browserAction,
        });
        // The composer stays inert from the submit until the new campaign's
        // page opens, so nothing touches it in between.
        await waitForPath(
          page,
          savedCampaignPath,
          workspaceE2ETimeouts.uiTransition
        );
        const createdId = new URL(page.url()).pathname.split("/").at(-1);
        campaignId = createdId ? campaignIdSchema.make(createdId) : undefined;
      }
    );
    yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        const [campaign] = yield* readCampaigns(db, plan);
        ok(campaign, "the automated campaign must be persisted");
        equal(campaign.id, id);
        equal(campaign.status, "draft");
      }),
      id: "automation-assert-campaign",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });

    yield* browserStep(
      "automation-build-flow",
      workspaceE2ETimeouts.uiTransition * 2,
      "build the reservation-booked flow with a tag condition",
      async (page) => {
        await waitForReactSubmitHandler(
          page,
          flowForm(page),
          workspaceE2ETimeouts.uiTransition
        );
        // Until a trigger is chosen, the family radios are visually hidden
        // inside their cards, so the card takes the click.
        await flowForm(page)
          .locator("label")
          .filter({ has: page.getByRole("radio", { name: /^Event\b/ }) })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        await flowForm(page)
          .getByRole("radio", { name: /^Reservation booked\b/ })
          .check({ timeout: workspaceE2ETimeouts.browserAction });
        await flowForm(page)
          .getByRole("button", { exact: true, name: "Add a step as step 1" })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        // Insert menu items carry a hint after their name.
        await page
          .getByRole("menu")
          .getByRole("menuitem", { name: /^Condition\b/ })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        await addDotyposTagCondition(page, flowForm(page), plan.customerTag);
        const save = flowForm(page).getByRole("button", {
          exact: true,
          name: "Save flow",
        });
        await save.click({ timeout: workspaceE2ETimeouts.browserAction });
        // Save stays enabled only while the working copy differs from the
        // saved flow.
        await expect(save).toBeDisabled({
          timeout: workspaceE2ETimeouts.uiTransition,
        });
      }
    );
    yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        const [automation] = yield* rowsAppear(
          readAutomations(db, id).pipe(
            Effect.map((rows) => rows.filter((row) => row.flow !== null))
          ),
          "the saved automation flow"
        );
        const flow = yield* Schema.decodeUnknownEffect(AutomationFlow)(
          automation?.flow
        ).pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("decode the saved automation flow", cause)
          )
        );
        equal(flow.trigger._tag, "ReservationBooked");
        deepEqual(
          flow.steps.map((step) => step._tag),
          ["Condition", "Send"]
        );
        const [condition] = flow.steps;
        const filter =
          condition?._tag === "Condition"
            ? JSON.stringify(condition.filter)
            : "";
        ok(
          filter.includes('"dotyposTags"') && filter.includes(plan.customerTag),
          "the saved condition must require the run's Dotypos tag"
        );
      }),
      id: "automation-assert-flow",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });

    yield* browserStep(
      "automation-write-email",
      workspaceE2ETimeouts.uiTransition * 2,
      "write and save the Czech automation email",
      async (page) => {
        await page.goto(campaignPath("/email"), {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
        await waitForReactSubmitHandler(
          page,
          composerForm(page),
          workspaceE2ETimeouts.uiTransition
        );
        await composerForm(page)
          .getByRole("tabpanel")
          .getByLabel("Subject", { exact: true })
          .fill(plan.subject, { timeout: workspaceE2ETimeouts.browserAction });
        const editor = page.locator("#campaign-body-cs-CZ");
        await editor.click({ timeout: workspaceE2ETimeouts.browserAction });
        await editor.pressSequentially(plan.body, {
          timeout: workspaceE2ETimeouts.browserAction,
        });
        await composerSubmit(page, "Save changes").click({
          timeout: workspaceE2ETimeouts.browserAction,
        });
      }
    );
    yield* runStep({
      execute: rowsAppear(
        readCampaigns(db, plan).pipe(
          Effect.map((rows) =>
            rows.filter((row) => row.content["cs-CZ"]?.subject === plan.subject)
          )
        ),
        "the saved Czech automation email"
      ).pipe(Effect.asVoid),
      id: "automation-assert-email",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });

    yield* browserStep(
      "automation-start-dry-run",
      workspaceE2ETimeouts.uiTransition * 2,
      "start the automation dry run",
      async (page) => {
        await page.goto(campaignPath("/preview"), {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
        const start = page.getByRole("button", {
          exact: true,
          name: "Run dry run",
        });
        await waitForReactClickHandler(page, start);
        await start.click({ timeout: workspaceE2ETimeouts.browserAction });
        await page.waitForURL(
          (url) =>
            url.pathname.endsWith("/preview") &&
            url.searchParams.has("preview"),
          { timeout: workspaceE2ETimeouts.uiTransition, waitUntil: "commit" }
        );
      }
    );
    yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        yield* pollAutomationEngine({
          intervalMs: workspaceE2EPollIntervalMs.automationPlanner,
          label: "the automation dry run",
          observe: readPreviewStatuses(db, id).pipe(
            Effect.flatMap((statuses) =>
              statuses.includes("failed")
                ? workspaceE2EError("The automation dry run failed", {
                    operation: "await the automation dry run",
                  })
                : Effect.succeed(
                    statuses.includes("completed") ? true : undefined
                  )
            )
          ),
          tick: journey.tickPlanner,
          timeoutMs: workspaceE2ETimeouts.automationEngine,
        });
      }),
      id: "automation-await-dry-run",
      timeoutMs:
        workspaceE2ETimeouts.automationEngine +
        workspaceE2ETimeouts.providerTransition,
    });

    yield* browserStep(
      "automation-activate",
      workspaceE2ETimeouts.uiTransition * 2,
      "activate the dry-run automation",
      async (page) => {
        // The database already shows the dry run finished; a reload renders
        // the page from that state instead of waiting on the page's poll.
        await page.reload({ timeout: workspaceE2ETimeouts.browserNavigation });
        const activate = page.getByRole("button", {
          exact: true,
          name: "Activate",
        });
        await expect(activate).toBeEnabled({
          timeout: workspaceE2ETimeouts.uiTransition,
        });
        await waitForReactClickHandler(page, activate);
        await activate.click({ timeout: workspaceE2ETimeouts.browserAction });
        await page.getByRole("button", { exact: true, name: "Pause" }).waitFor({
          state: "visible",
          timeout: workspaceE2ETimeouts.uiTransition,
        });
      }
    );
    yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        const [automation] = yield* readAutomations(db, id);
        ok(
          automation?.activeVersionId && automation.acceptingSince,
          "the automation must be active and accepting reservation events"
        );
      }),
      id: "automation-assert-active",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });

    // The booker signs in and books the case's own zero-total reservation,
    // which records the reservation-booked event the automation waits for.
    yield* journey.book(context);

    yield* runStep({
      execute: Effect.gen(function* () {
        const bookedCustomerId =
          journey.checkoutState.checkoutRow?.dotypos_customer_id;
        if (!bookedCustomerId) {
          return yield* workspaceE2EError(
            "The automation reservation has no Dotypos customer",
            { operation: "qualify the automation customer" }
          );
        }
        customerId = bookedCustomerId;
        addRedaction(bookedCustomerId);
        // No planner tick has run since the booking, so the customer is
        // tagged and consenting before intake evaluates the audience gate.
        yield* setSyntheticCustomerProfileTags(
          journey.datasourceConfig,
          bookedCustomerId,
          [plan.customerTag]
        );
        const documentHash = yield* Effect.try({
          catch: () =>
            workspaceE2EError(
              "Read marketing communications document hash failed",
              { operation: "read marketing communications document hash" }
            ),
          try: () => getWorkspaceE2EMarketingDocumentHash(),
        });
        const grantedAt = Temporal.Now.instant();
        yield* db
          .insert(customerMarketingConsents)
          .values({
            documentHash,
            dotyposCustomerId: bookedCustomerId,
            grantedAt,
            locale: "cs-CZ",
            withdrawnAt: null,
          })
          .onConflictDoUpdate({
            set: { documentHash, grantedAt, withdrawnAt: null },
            target: customerMarketingConsents.dotyposCustomerId,
          })
          .pipe(
            Effect.mapError((cause) =>
              toWorkspaceE2EError("grant synthetic marketing consent", cause)
            )
          );
      }),
      id: "automation-qualify-customer",
      timeoutMs: workspaceE2ETimeouts.cleanupAction,
    });

    const runId = yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        const qualified = customerId;
        if (qualified === undefined) {
          return yield* workspaceE2EError(
            "The automation customer was not qualified",
            { operation: "await the sent automation run" }
          );
        }
        // Intake takes an event only once the engine's tick at or before
        // the planner's instant has reached it (D36), so no tick before the
        // next quarter-hour can start the run.
        const [booked] = yield* rowsAppear(
          readBookedEvents(db, qualified),
          "the reservation-booked customer event"
        );
        if (!booked) {
          return yield* workspaceE2EError(
            "The reservation-booked customer event was not recorded",
            { operation: "await the sent automation run" }
          );
        }
        const eligibleAt = automationTickAtOrAfter(booked.occurredAt);
        yield* Effect.sleep(
          Math.max(
            0,
            eligibleAt.epochMilliseconds -
              Temporal.Now.instant().epochMilliseconds
          )
        );
        return yield* pollAutomationEngine({
          intervalMs: workspaceE2EPollIntervalMs.automationPlanner,
          label: "the sent automation run",
          observe: readCustomerRuns(db, id, qualified).pipe(
            Effect.flatMap((runs) => {
              const sent = runs.find((run) => run.outcome === "sent");
              if (sent) return Effect.succeed(sent.id);
              const ended = runs.find((run) => run.status === "ended");
              return ended
                ? workspaceE2EError(
                    `The automation run ended as ${ended.outcome ?? "unknown"} (${ended.outcomeReason ?? "no reason"})`,
                    { operation: "await the sent automation run" }
                  )
                : Effect.succeed(undefined);
            })
          ),
          tick: journey.tickPlanner,
          timeoutMs: workspaceE2ETimeouts.automationEngine,
        });
      }),
      id: "automation-await-sent-run",
      timeoutMs:
        workspaceE2ETimeouts.datasource +
        workspaceE2ETimeouts.automationTick +
        workspaceE2ETimeouts.automationEngine +
        workspaceE2ETimeouts.providerTransition,
    });

    yield* browserStep(
      "automation-open-sent-run",
      workspaceE2ETimeouts.uiTransition * 2,
      "find the sent run in the run log and open it",
      async (page) => {
        await page.goto(campaignPath("/runs"), {
          timeout: workspaceE2ETimeouts.browserNavigation,
        });
        await page.locator("#automation-run-outcome").selectOption("sent", {
          timeout: workspaceE2ETimeouts.browserAction,
        });
        await page
          .getByRole("button", { exact: true, name: "Show runs" })
          .click({ timeout: workspaceE2ETimeouts.browserAction });
        await page.waitForURL(
          (url) =>
            url.pathname.endsWith("/runs") &&
            url.searchParams.get("outcome") === "sent",
          { timeout: workspaceE2ETimeouts.uiTransition, waitUntil: "commit" }
        );
        // The run link's text is a formatted time; its target is the run.
        // The list renders as cards or a table by width, with the other
        // hidden, so only the visible link takes the click.
        const runLink = page
          .locator(`a[href$="/runs/${runId}"]`)
          .filter({ visible: true });
        await runLink.click({ timeout: workspaceE2ETimeouts.uiTransition });
        await waitForPath(
          page,
          new RegExp(`/runs/${runId}$`),
          workspaceE2ETimeouts.uiTransition
        );
        await expect(
          page.getByRole("list", { exact: true, name: "Run timeline" })
        ).toBeVisible({ timeout: workspaceE2ETimeouts.uiTransition });
      }
    );

    yield* browserStep(
      "automation-pause",
      workspaceE2ETimeouts.uiTransition,
      "pause the automation",
      async (page) => {
        const pause = page.getByRole("button", { exact: true, name: "Pause" });
        await waitForReactClickHandler(page, pause);
        await pause.click({ timeout: workspaceE2ETimeouts.browserAction });
        await page
          .getByRole("button", { exact: true, name: "Resume" })
          .waitFor({
            state: "visible",
            timeout: workspaceE2ETimeouts.uiTransition,
          });
      }
    );
    yield* runStep({
      execute: Effect.gen(function* () {
        const id = yield* requireCampaignId;
        const [automation] = yield* readAutomations(db, id);
        ok(
          automation?.pausedAt && automation.acceptingSince === null,
          "the paused automation must stop accepting reservation events"
        );
      }),
      id: "automation-assert-paused",
      timeoutMs: workspaceE2ETimeouts.datasource,
    });
  });

  const release = Effect.suspend(() =>
    releaseEmailCampaignFixture({
      audiencePersisted: rowsAppear(
        readAudiences(db, plan),
        "the automation audience before cleanup"
      ).pipe(Effect.as(true)),
      audienceSubmission,
      barrierTimeoutMs: workspaceE2ETimeouts.uiTransition,
      campaignPersisted: rowsAppear(
        readCampaigns(db, plan),
        "the automated campaign before cleanup"
      ).pipe(Effect.as(true)),
      campaignSubmission,
      closeBrowser: withinWorkspaceE2EDeadline(
        admin.session.close(),
        `${automationReservationCaseId}/close-browser`,
        workspaceE2ETimeouts.browserAction
      ),
      deleteRows: deleteAutomationJourneyRows(db, {
        campaignTitles: [plan.campaignTitle],
        audienceTitles: [plan.audienceTitle],
        customerIds: customerId === undefined ? [] : [customerId],
      }),
    })
  );
  const clearTag = Effect.suspend(() =>
    customerId === undefined
      ? Effect.void
      : setSyntheticCustomerProfileTags(
          journey.datasourceConfig,
          customerId,
          []
        )
  );

  yield* body.pipe(
    Effect.ensuring(
      withinWorkspaceE2EDeadline(
        release.pipe(Effect.ensuring(clearTag.pipe(Effect.orDie))),
        `${automationReservationCaseId}/cleanup`,
        workspaceE2EAutomationJourneyCleanupTimeout
      ).pipe(Effect.orDie)
    )
  );
}, Effect.scoped);

const readCampaigns = (db: DatabaseClient, plan: AutomationJourneyPlan) =>
  db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.title, plan.campaignTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the automated campaign", cause)
      )
    );

const readAudiences = (db: DatabaseClient, plan: AutomationJourneyPlan) =>
  db
    .select()
    .from(emailCampaignAudiences)
    .where(eq(emailCampaignAudiences.title, plan.audienceTitle))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the automation audience", cause)
      )
    );

const readAutomations = (db: DatabaseClient, campaignId: CampaignId) =>
  db
    .select()
    .from(emailCampaignAutomations)
    .where(eq(emailCampaignAutomations.campaignId, campaignId))
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the automation", cause)
      )
    );

const readPreviewStatuses = (db: DatabaseClient, campaignId: CampaignId) =>
  db
    .select({ status: emailCampaignAutomationPreviews.status })
    .from(emailCampaignAutomationPreviews)
    .where(eq(emailCampaignAutomationPreviews.campaignId, campaignId))
    .pipe(
      Effect.map((rows) => rows.map((row) => row.status)),
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the automation dry runs", cause)
      )
    );

const readBookedEvents = (db: DatabaseClient, customerId: DotyposCustomerId) =>
  db
    .select({ occurredAt: customerEvents.occurredAt })
    .from(customerEvents)
    .where(
      and(
        eq(customerEvents.dotyposCustomerId, customerId),
        eq(customerEvents.kind, "reservation-booked")
      )
    )
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the reservation-booked customer event", cause)
      )
    );

const readCustomerRuns = (
  db: DatabaseClient,
  campaignId: CampaignId,
  customerId: DotyposCustomerId
) =>
  db
    .select({
      id: emailCampaignAutomationRuns.id,
      outcome: emailCampaignAutomationRuns.outcome,
      outcomeReason: emailCampaignAutomationRuns.outcomeReason,
      status: emailCampaignAutomationRuns.status,
    })
    .from(emailCampaignAutomationRuns)
    .where(
      and(
        eq(emailCampaignAutomationRuns.campaignId, campaignId),
        eq(emailCampaignAutomationRuns.dotyposCustomerId, customerId)
      )
    )
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the customer's automation runs", cause)
      )
    );

/**
 * Deletes the journey's automated campaigns with every automation row they
 * own (runs, units, receipts, sends, versions), then their audiences and the
 * customers' synthetic consent rows, and proves none remain. Runs reference
 * the booked reservation, so this runs before checkout cleanup.
 */
const deleteAutomationJourneyRows = Effect.fn("deleteAutomationJourneyRows")(
  function* (
    db: RootDatabaseClient,
    rows: {
      readonly audienceTitles: readonly string[];
      readonly campaignTitles: readonly string[];
      readonly customerIds: readonly DotyposCustomerId[];
    }
  ) {
    const campaignIds =
      rows.campaignTitles.length === 0
        ? []
        : (yield* db
            .select({ id: emailCampaigns.id })
            .from(emailCampaigns)
            .where(inArray(emailCampaigns.title, [...rows.campaignTitles]))
            .pipe(
              Effect.mapError((cause) =>
                toWorkspaceE2EError("find the automated campaigns", cause)
              )
            )).map((row) => row.id);
    if (campaignIds.length > 0) {
      yield* Effect.tryPromise({
        catch: (cause) =>
          toWorkspaceE2EError("delete the automated campaigns", cause),
        try: () => deleteAutomatedCampaigns(db, campaignIds),
      });
    }
    if (rows.audienceTitles.length > 0) {
      yield* db
        .delete(emailCampaignAudiences)
        .where(inArray(emailCampaignAudiences.title, [...rows.audienceTitles]))
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("delete the automation audiences", cause)
          )
        );
    }
    if (rows.customerIds.length > 0) {
      yield* db
        .delete(customerMarketingConsents)
        .where(
          inArray(customerMarketingConsents.dotyposCustomerId, [
            ...rows.customerIds,
          ])
        )
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("delete synthetic marketing consent", cause)
          )
        );
    }
    if (rows.campaignTitles.length > 0) {
      const remaining = yield* db
        .select({ id: emailCampaigns.id })
        .from(emailCampaigns)
        .where(inArray(emailCampaigns.title, [...rows.campaignTitles]))
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("verify automated campaign cleanup", cause)
          )
        );
      equal(remaining.length, 0);
    }
    if (rows.audienceTitles.length > 0) {
      const remaining = yield* db
        .select({ id: emailCampaignAudiences.id })
        .from(emailCampaignAudiences)
        .where(inArray(emailCampaignAudiences.title, [...rows.audienceTitles]))
        .pipe(
          Effect.mapError((cause) =>
            toWorkspaceE2EError("verify automation audience cleanup", cause)
          )
        );
      equal(remaining.length, 0);
    }
  }
);

/**
 * The suite cleanup's fallback for a run whose case never reached its own
 * finalizer: deletes every automated campaign and audience titled with the
 * run's prefix. The journaled checkout contact identifies the booked
 * customer whatever its run reached, so its consent row is deleted and its
 * tags are cleared too.
 */
export const deleteRunAutomationJourneys = Effect.fn(
  "deleteRunAutomationJourneys"
)(function* (input: {
  readonly contacts: readonly CheckoutData[];
  readonly datasourceConfig: DatasourceConfig;
  readonly db: RootDatabaseClient;
  readonly runId: WorkspaceE2ERunId;
}) {
  const { db } = input;
  const prefix = automationJourneyTitlePrefix(input.runId);
  const campaigns = yield* db
    .select({ title: emailCampaigns.title })
    .from(emailCampaigns)
    .where(sql`starts_with(${emailCampaigns.title}, ${prefix})`)
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("find the run's automated campaigns", cause)
      )
    );
  const audiences = yield* db
    .select({ title: emailCampaignAudiences.title })
    .from(emailCampaignAudiences)
    .where(sql`starts_with(${emailCampaignAudiences.title}, ${prefix})`)
    .pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError("find the run's automation audiences", cause)
      )
    );
  const customerIds =
    input.contacts.length === 0
      ? []
      : yield* readCheckoutCleanupCustomerIds(
          input.datasourceConfig,
          input.contacts
        );
  yield* deleteAutomationJourneyRows(db, {
    audienceTitles: audiences.map((audience) => audience.title),
    campaignTitles: campaigns.map((campaign) => campaign.title),
    customerIds,
  });
  yield* Effect.forEach(
    customerIds,
    (customerId) =>
      setSyntheticCustomerProfileTags(input.datasourceConfig, customerId, []),
    { discard: true }
  );
});
