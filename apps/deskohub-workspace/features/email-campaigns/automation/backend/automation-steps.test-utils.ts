import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import type {
  AutomationConditionFilter,
  AutomationFlowType as AutomationFlow,
  AutomationStepType as AutomationStep,
  AutomationWaitType as AutomationWait,
} from "@deskohub/workspace-admin-api";
import { asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  customerMarketingConsents,
  emailCampaignAutomationRunEvents,
  emailCampaignAutomationRuns,
  emailCampaignAutomations,
  emailCampaigns,
} from "@/db/schema";
import {
  seedAutomatedCampaign,
  seedAutomation,
  seedAutomationVersion,
} from "../../backend/email-campaigns.test-utils";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import type { AutomationRunPhase } from "../automation-states";

/** A step id as flows spell it. */
const stepId = (id: string) => id as AutomationStepId;

export const waitStep = (id: string, wait: AutomationWait): AutomationStep => ({
  _tag: "Wait",
  id: stepId(id),
  wait,
});

export const conditionStep = (
  id: string,
  filter: AutomationConditionFilter
): AutomationStep => ({ _tag: "Condition", id: stepId(id), filter });

const sendStep = (id = "send"): AutomationStep => ({
  _tag: "Send",
  id: stepId(id),
});

/** A decodable flow: an account-created trigger and `steps`, ending in `send`. */
export const automationFlowOf = (
  ...steps: readonly AutomationStep[]
): AutomationFlow => ({
  trigger: { _tag: "AccountCreated" },
  steps: [...steps, sendStep()],
});

/**
 * An active automated campaign with version 1 of `flow` in force and its
 * automation row, accepting since `acceptingSince`.
 */
export const seedFlowAutomation = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly flow: AutomationFlow;
    readonly activatedAt: Temporal.Instant;
  }
) => {
  const campaignId = await seedAutomatedCampaign(db, { purpose: "marketing" });
  const versionId = await seedAutomationVersion(db, {
    campaignId,
    purpose: "marketing",
    flow: input.flow,
    activatedAt: input.activatedAt,
  });
  await seedAutomation(db, {
    campaignId,
    activeVersionId: versionId,
    acceptingSince: input.activatedAt,
  });
  return { campaignId, versionId };
};

/** A Dotypos customer id unique to one test file's run. */
export const testCustomerId = (prefix: string) => (label: string) =>
  DotyposCustomerIdSchema.make(`${prefix}-${label}`);

/**
 * Makes customers known to Workspace (a marketing consent row), so
 * conditions evaluate them instead of returning `unknown`.
 */
export const seedKnownCustomers = (
  db: WorkspaceDatabaseClient,
  ids: readonly DotyposCustomerId[]
) =>
  Effect.runPromise(
    db.insert(customerMarketingConsents).values(
      ids.map((dotyposCustomerId) => ({
        dotyposCustomerId,
        documentHash: "hash",
        locale: "cs-CZ" as const,
        grantedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
      }))
    )
  );

export const deleteKnownCustomers = (
  db: WorkspaceDatabaseClient,
  ids: readonly DotyposCustomerId[]
) =>
  Effect.runPromise(
    db
      .delete(customerMarketingConsents)
      .where(inArray(customerMarketingConsents.dotyposCustomerId, [...ids]))
  );

/**
 * An open run at `stepId` as entry and the engine leave it. Its trigger is
 * an account creation at `triggerAt` (default: `stepEnteredAt`).
 */
export const seedAutomationRun = async (
  db: WorkspaceDatabaseClient,
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly customerId: DotyposCustomerId;
    readonly stepId: string;
    readonly phase: AutomationRunPhase;
    readonly stepEnteredAt: Temporal.Instant;
    readonly dueAt: Temporal.Instant;
    readonly workUnitId?: AutomationWorkUnitId;
    readonly triggerAt?: Temporal.Instant;
  }
) => {
  const [run] = await Effect.runPromise(
    db
      .insert(emailCampaignAutomationRuns)
      .values({
        campaignId: input.campaignId,
        versionId: input.versionId,
        dotyposCustomerId: input.customerId,
        triggerKind: "account-created",
        triggerAt: input.triggerAt ?? input.stepEnteredAt,
        status: "active",
        stepId: stepId(input.stepId),
        phase: input.phase,
        stepEnteredAt: input.stepEnteredAt,
        dueAt: input.dueAt,
        workUnitId: input.workUnitId ?? null,
      })
      .returning({ id: emailCampaignAutomationRuns.id })
  );
  return run!.id;
};

export const readAutomationRun = async (
  db: WorkspaceDatabaseClient,
  runId: AutomationRunId
) => {
  const [run] = await Effect.runPromise(
    db
      .select()
      .from(emailCampaignAutomationRuns)
      .where(eq(emailCampaignAutomationRuns.id, runId))
  );
  return run!;
};

/** The run's timeline, oldest first, without sequence numbers; `at` as ISO text. */
export const readAutomationRunTimeline = (
  db: WorkspaceDatabaseClient,
  runId: AutomationRunId
) =>
  Effect.runPromise(
    db
      .select({
        kind: emailCampaignAutomationRunEvents.kind,
        stepId: emailCampaignAutomationRunEvents.stepId,
        at: emailCampaignAutomationRunEvents.at,
        detail: emailCampaignAutomationRunEvents.detail,
      })
      .from(emailCampaignAutomationRunEvents)
      .where(eq(emailCampaignAutomationRunEvents.runId, runId))
      .orderBy(asc(emailCampaignAutomationRunEvents.sequence))
      .pipe(
        Effect.map((entries) =>
          entries.map((entry) => ({ ...entry, at: entry.at.toString() }))
        )
      )
  );

/** An instant as timeline details store it. */
export const detailInstant = (instant: Temporal.Instant) =>
  new Date(instant.epochMilliseconds).toISOString();

/**
 * Sets an automation's lifecycle as pause and resume leave it (§5.10), for
 * tests that only need the state, not `AutomationLifecycle`'s other effects.
 */
export const setAutomationLifecycle = async (
  db: WorkspaceDatabaseClient,
  campaignId: CampaignId,
  state:
    | { readonly status: "paused"; readonly at: Temporal.Instant }
    | { readonly status: "active"; readonly resumedAt: Temporal.Instant }
) => {
  await Effect.runPromise(
    db
      .update(emailCampaigns)
      .set({ status: state.status })
      .where(eq(emailCampaigns.id, campaignId))
  );
  await Effect.runPromise(
    db
      .update(emailCampaignAutomations)
      .set(
        state.status === "paused"
          ? { pausedAt: state.at, acceptingSince: null, nextFireAt: null }
          : { resumedAt: state.resumedAt, acceptingSince: state.resumedAt }
      )
      .where(eq(emailCampaignAutomations.campaignId, campaignId))
  );
};
