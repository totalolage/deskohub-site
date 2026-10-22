import "server-only";

import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { emailCampaignAutomations, emailCampaigns } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignId } from "../../campaign-identifiers";
import type { CampaignStatus } from "../../campaign-states";
import type { AutomationVersionId } from "../automation-identifiers";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

/*
 * The automation row is the lifecycle lock. Lock order, so no wait cycle
 * can form (§5.4): (1) this lock; (2) triggering `workspace_reservations`
 * rows `FOR SHARE`; (3) run rows by compare-and-set, in id order; (4) send,
 * recipient and batch rows; (5) unit rows; (6) the slot lock, under which
 * promotion locks only `planned` rows no one holds (`SKIP LOCKED`). Take it
 * first in the transaction. Intake alone takes one lock before it: all its
 * events' `customer_accounts` rows `FOR SHARE`, in id order, in one
 * statement. Their writers (a claim, a deletion, the legacy marking) take
 * no lock here and nothing holding one waits for an account row.
 */

/**
 * An automation's lifecycle as of the lock grant. A missing automation row
 * (a deleted draft) reads with every field null, so it isn't active.
 */
export type AutomationLifecycleState = {
  readonly status: CampaignStatus | null;
  readonly activeVersionId: AutomationVersionId | null;
  readonly acceptingSince: Temporal.Instant | null;
  readonly resumedAt: Temporal.Instant | null;
  readonly nextFireAt: Temporal.Instant | null;
};

/**
 * Takes the lifecycle lock shared, for unit commits and planner writes, and
 * reads the lifecycle under it. Activate, pause, resume and archive hold
 * the lock exclusively while they change the campaign's status, so the
 * state stays as read until this transaction ends. Replay and settlement
 * take it only to serialise with archive.
 *
 * Two statements: after a lock wait, READ COMMITTED re-fetches only the
 * locked row, so one `FOR SHARE OF a` join could pair a pause's new
 * automation row with the campaign status from before it. The separate
 * read takes a fresh snapshot that sees every lifecycle commit made before
 * the grant.
 */
export const lockAutomationForEngine = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
): Effect.Effect<AutomationLifecycleState, DatabaseQueryError> =>
  lockAutomation(tx, { campaignId, strength: "share" });

/**
 * Takes the lifecycle lock exclusively, for activate, pause, resume and
 * archive, and reads the lifecycle under it. Only these operations write an
 * automated campaign's `status`, in the transaction that holds this lock.
 * Nothing else of the automation runs while it's held.
 */
export const lockAutomationForLifecycle = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
): Effect.Effect<AutomationLifecycleState, DatabaseQueryError> =>
  lockAutomation(tx, { campaignId, strength: "update" });

const missingAutomation: AutomationLifecycleState = {
  status: null,
  activeVersionId: null,
  acceptingSince: null,
  resumedAt: null,
  nextFireAt: null,
};

const lockAutomation = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly strength: "share" | "update";
  }
) =>
  tx
    .select({ locked: sql<number>`1` })
    .from(emailCampaignAutomations)
    .where(eq(emailCampaignAutomations.campaignId, input.campaignId))
    .for(input.strength)
    .pipe(
      Effect.flatMap(([locked]) =>
        locked === undefined
          ? Effect.succeed(missingAutomation)
          : readLifecycle(tx, input.campaignId)
      )
    );

const readLifecycle = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
) =>
  tx
    .select({
      status: emailCampaigns.status,
      activeVersionId: emailCampaignAutomations.activeVersionId,
      acceptingSince: emailCampaignAutomations.acceptingSince,
      resumedAt: emailCampaignAutomations.resumedAt,
      nextFireAt: emailCampaignAutomations.nextFireAt,
    })
    .from(emailCampaignAutomations)
    .innerJoin(
      emailCampaigns,
      eq(emailCampaigns.id, emailCampaignAutomations.campaignId)
    )
    .where(eq(emailCampaignAutomations.campaignId, campaignId))
    .pipe(
      Effect.map(
        ([state]): AutomationLifecycleState => state ?? missingAutomation
      )
    );
