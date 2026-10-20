import type { DotyposCustomerId } from "@deskohub/dotypos";
import type {
  AutomationRunEventDetail,
  AutomationTrigger,
} from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AudienceFilter } from "@/features/email-campaigns/audience-filter";
import type {
  AutomationPreviewId,
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
  AutomationWorkUnitId,
} from "@/features/email-campaigns/automation/automation-identifiers";
import {
  type AutomationPreviewKind,
  type AutomationPreviewOutcome,
  type AutomationPreviewState,
  type AutomationRunEventKind,
  type AutomationRunFailureReason,
  type AutomationRunOutcome,
  type AutomationRunPhase,
  type AutomationRunState,
  type AutomationScheduleFireStatus,
  type AutomationTriggerDisposition,
  type AutomationTriggerKind,
  automationPreviewKinds,
  automationPreviewOutcomes,
  automationPreviewStatuses,
  automationRunEventKinds,
  automationRunOutcomes,
  automationScheduleFireStatuses,
  automationTriggerDispositions,
  automationTriggerKinds,
} from "@/features/email-campaigns/automation/automation-states";
import {
  type AutomationWorkUnitStatus,
  automationWorkUnitStatuses,
} from "@/features/email-campaigns/automation/automation-work-units";
import type {
  CampaignLocalizedContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "@/features/email-campaigns/body/campaign-content";
import type { CampaignContentHash } from "@/features/email-campaigns/body/campaign-content-hash";
import type {
  CampaignAudienceId,
  CampaignId,
  CampaignSendId,
} from "@/features/email-campaigns/campaign-identifiers";
import type { CampaignRecipientSkipReason } from "@/features/email-campaigns/campaign-states";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { CustomerEventId } from "@/shared/backend/customer-events/customer-event";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { authUser } from "./auth";
import { customerEvents } from "./customer-events";
import {
  campaignPurposes,
  emailCampaignAudiences,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "./email-campaigns";
import { quotedSqlList } from "./sql-list";
import { workspaceReservations } from "./workspace-reservations";

/**
 * Immutable published snapshots of an automated campaign. At time `t`, the
 * version with the latest `activated_at ≤ t` handles every occurrence. The
 * `email_campaign_automation_versions_immutable` trigger rejects every
 * update and delete, so the row has no foreign key with a delete action.
 */
export const emailCampaignAutomationVersions = pgTable(
  "email_campaign_automation_versions",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<AutomationVersionId>(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    versionNumber: integer("version_number").notNull(),
    // Saved-audience conditions store ids only; they're evaluated live.
    flow: jsonb("flow").notNull(),
    // The flow trigger's tag, such as "Schedule" or "ReservationBooked".
    triggerKind: text("trigger_kind")
      .notNull()
      .$type<AutomationTrigger["_tag"]>()
      .generatedAlwaysAs(sql`flow->'trigger'->>'_tag'`),
    purpose: text("purpose").notNull().$type<CampaignPurpose>(),
    templateKey: text("template_key").notNull().$type<CampaignTemplateKey>(),
    content: jsonb("content").notNull().$type<CampaignLocalizedContent>(),
    contentHash: text("content_hash").notNull().$type<CampaignContentHash>(),
    /** The entry audience as published. */
    audienceFilter: jsonb("audience_filter").notNull().$type<AudienceFilter>(),
    draftHash: text("draft_hash").notNull(),
    activatedAt: instant("activated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("email_campaign_automation_versions_number_unique_idx").on(
      t.campaignId,
      t.versionNumber
    ),
    // The target of the composite foreign keys that pin a version to its campaign.
    uniqueIndex("email_campaign_automation_versions_campaign_unique_idx").on(
      t.id,
      t.campaignId
    ),
    uniqueIndex("email_campaign_automation_versions_activated_unique_idx").on(
      t.campaignId,
      t.activatedAt
    ),
    check(
      "email_campaign_automation_versions_number_check",
      sql`${t.versionNumber} >= 1`
    ),
    check(
      "email_campaign_automation_versions_purpose_check",
      sql`${t.purpose} in (${quotedSqlList(campaignPurposes)})`
    ),
  ]
);

/**
 * The mutable references of a version, kept apart so the version row never
 * needs an update when the activating account or the source audience is
 * deleted.
 */
export const emailCampaignAutomationVersionProvenance = pgTable(
  "email_campaign_automation_version_provenance",
  {
    versionId: text("version_id")
      .primaryKey()
      .references(() => emailCampaignAutomationVersions.id, {
        onDelete: "cascade",
      })
      .$type<AutomationVersionId>(),
    audienceId: text("audience_id")
      .references(() => emailCampaignAudiences.id, { onDelete: "set null" })
      .$type<CampaignAudienceId>(),
    activatedByAccountId: text("activated_by_account_id").references(
      () => authUser.id,
      { onDelete: "set null" }
    ),
  }
);

/**
 * One row per automated campaign: the working copy of its flow and its
 * lifecycle timestamps. It's also the lifecycle lock: lifecycle operations
 * take it `FOR UPDATE`, and engine writes take it `FOR SHARE`.
 */
export const emailCampaignAutomations = pgTable(
  "email_campaign_automations",
  {
    campaignId: text("campaign_id")
      .primaryKey()
      .references(() => emailCampaigns.id, { onDelete: "cascade" })
      .$type<CampaignId>(),
    /** The working copy; null until first saved. */
    flow: jsonb("flow"),
    activeVersionId: text("active_version_id").$type<AutomationVersionId>(),
    /** Set on activate and resume; null while draft, paused or archived. */
    acceptingSince: instant("accepting_since"),
    pausedAt: instant("paused_at"),
    resumedAt: instant("resumed_at"),
    archivedAt: instant("archived_at"),
    /** Schedule triggers only: the oldest fire not yet entered. */
    nextFireAt: instant("next_fire_at"),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "email_campaign_automations_active_version_fk",
      columns: [t.activeVersionId, t.campaignId],
      foreignColumns: [
        emailCampaignAutomationVersions.id,
        emailCampaignAutomationVersions.campaignId,
      ],
    }),
    index("email_campaign_automations_next_fire_idx")
      .on(t.nextFireAt)
      .where(sql`${t.nextFireAt} is not null`),
    check(
      "email_campaign_automations_accepting_check",
      sql`(${t.acceptingSince} is null) or (${t.activeVersionId} is not null)`
    ),
  ]
);

/**
 * Engine work bounded to one queue-consumer invocation. At most a few are
 * in flight (`enqueued` or `claimed`); each settles once, by claim CAS.
 */
export const emailCampaignAutomationWorkUnits = pgTable(
  "email_campaign_automation_work_units",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<AutomationWorkUnitId>(),
    // No check: a deployment claims, promotes and reaps only kinds it supports.
    kind: text("kind").notNull(),
    priority: smallint("priority").notNull(),
    /** Null for sweep pages and intake. */
    campaignId: text("campaign_id")
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    /** Deterministic per kind, so repeated planning is a no-op. */
    key: text("key").notNull(),
    /** Ids and windows only; never a fetched fact. */
    subject: jsonb("subject").notNull(),
    /** Planned Dotypos requests. */
    requestCost: smallint("request_cost").notNull(),
    status: text("status").notNull().$type<AutomationWorkUnitStatus>(),
    claimId: text("claim_id"),
    claimExpiresAt: instant("claim_expires_at"),
    /** Set by pause or archive; never frees a slot. */
    cancelRequestedAt: instant("cancel_requested_at"),
    /** Deliver units only: set when the batch is persisted. */
    sendId: text("send_id")
      .references(() => emailCampaignSends.id)
      .$type<CampaignSendId>(),
    enqueueGeneration: integer("enqueue_generation").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    deadlineMisses: integer("deadline_misses").notNull().default(0),
    /** Times the unit settled `failed`; spaces out its replanning. */
    failures: integer("failures").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    firstAttemptAt: instant("first_attempt_at"),
    enqueuedAt: instant("enqueued_at"),
    settledAt: instant("settled_at"),
  },
  (t) => [
    uniqueIndex("email_campaign_automation_work_units_key_unique_idx").on(
      t.key
    ),
    index("email_campaign_automation_work_units_planned_idx")
      .on(t.priority, t.createdAt)
      .where(sql`${t.status} = 'planned'`),
    index("email_campaign_automation_work_units_in_flight_idx")
      .on(t.kind, t.campaignId)
      .where(sql`${t.status} in ('enqueued', 'claimed')`),
    index("email_campaign_automation_work_units_settled_idx")
      .on(t.settledAt)
      .where(sql`${t.settledAt} is not null`),
    check(
      "email_campaign_automation_work_units_status_check",
      sql`${t.status} in (${quotedSqlList(automationWorkUnitStatuses)})`
    ),
    check(
      "email_campaign_automation_work_units_claim_check",
      sql`(${t.status} = 'claimed') = (${t.claimId} is not null and ${t.claimExpiresAt} is not null)`
    ),
    check(
      "email_campaign_automation_work_units_settled_check",
      sql`(${t.status} in ('done', 'dropped', 'failed')) = (${t.settledAt} is not null)`
    ),
    check(
      "email_campaign_automation_work_units_cost_check",
      sql`${t.requestCost} >= 0`
    ),
  ]
);

/**
 * One customer's pass through one automation version. Every run-ending
 * path goes through `AutomationRunTransitions.end`.
 */
export const emailCampaignAutomationRuns = pgTable(
  "email_campaign_automation_runs",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<AutomationRunId>(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    versionId: text("version_id").notNull().$type<AutomationVersionId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    triggerKind: text("trigger_kind").notNull().$type<AutomationTriggerKind>(),
    triggerAt: instant("trigger_at").notNull(),
    triggerEventId: text("trigger_event_id")
      .references(() => customerEvents.id, { onDelete: "set null" })
      .$type<CustomerEventId>(),
    triggerReservationId: text("trigger_reservation_id")
      .references(() => workspaceReservations.id)
      .$type<WorkspaceReservationId>(),
    status: text("status").notNull().$type<AutomationRunState>(),
    /** The current step; the last step once ended. */
    stepId: text("step_id").notNull().$type<AutomationStepId>(),
    /** Active runs only; `waiting` at a send step means a deferred trigger. */
    phase: text("phase").$type<AutomationRunPhase>(),
    stepEnteredAt: instant("step_entered_at").notNull(),
    dueAt: instant("due_at"),
    /** The open condition or deliver unit that owns the run. */
    workUnitId: text("work_unit_id").$type<AutomationWorkUnitId>(),
    sendId: text("send_id").$type<CampaignSendId>(),
    outcome: text("outcome").$type<AutomationRunOutcome>(),
    outcomeReason: text("outcome_reason").$type<
      CampaignRecipientSkipReason | AutomationRunFailureReason
    >(),
    startedAt: instant("started_at").notNull().default(sql`now()`),
    endedAt: instant("ended_at"),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({
      name: "email_campaign_automation_runs_version_fk",
      columns: [t.versionId, t.campaignId],
      foreignColumns: [
        emailCampaignAutomationVersions.id,
        emailCampaignAutomationVersions.campaignId,
      ],
    }),
    // The migration declares this DEFERRABLE INITIALLY DEFERRED: delivery
    // inserts the recipients after the run's compare-and-set.
    foreignKey({
      name: "email_campaign_automation_runs_recipient_fk",
      columns: [t.sendId, t.dotyposCustomerId],
      foreignColumns: [
        emailCampaignRecipients.sendId,
        emailCampaignRecipients.dotyposCustomerId,
      ],
    }),
    uniqueIndex("email_campaign_automation_runs_one_open_run_idx")
      .on(t.campaignId, t.dotyposCustomerId)
      .where(sql`${t.status} <> 'ended'`),
    index("email_campaign_automation_runs_due_idx")
      .on(t.dueAt)
      .where(sql`${t.status} = 'active'`),
    index("email_campaign_automation_runs_unplanned_ready_idx")
      .on(t.campaignId, t.stepId)
      .where(
        sql`${t.status} = 'active' and ${t.phase} = 'ready' and ${t.workUnitId} is null`
      ),
    index("email_campaign_automation_runs_campaign_state_idx").on(
      t.campaignId,
      t.status,
      t.stepId
    ),
    index("email_campaign_automation_runs_campaign_started_idx").on(
      t.campaignId,
      t.startedAt
    ),
    index("email_campaign_automation_runs_trigger_reservation_idx")
      .on(t.triggerReservationId)
      .where(sql`${t.status} <> 'ended'`),
    index("email_campaign_automation_runs_send_idx")
      .on(t.sendId)
      .where(sql`${t.sendId} is not null`),
    check(
      "email_campaign_automation_runs_trigger_kind_check",
      sql`${t.triggerKind} in (${quotedSqlList(automationTriggerKinds)})`
    ),
    check(
      "email_campaign_automation_runs_status_check",
      sql`(${t.status} = 'active' and ${t.phase} is not null and ${t.phase} in ('ready', 'waiting') and ${t.dueAt} is not null and ${t.outcome} is null and ${t.endedAt} is null) or (${t.status} = 'sending' and ${t.phase} is null and ${t.dueAt} is null and ${t.sendId} is not null and ${t.outcome} is null and ${t.endedAt} is null) or (${t.status} = 'ended' and ${t.phase} is null and ${t.dueAt} is null and ${t.outcome} is not null and ${t.endedAt} is not null)`
    ),
    check(
      "email_campaign_automation_runs_outcome_check",
      sql`${t.outcome} is null or ${t.outcome} in (${quotedSqlList(automationRunOutcomes)})`
    ),
    check(
      "email_campaign_automation_runs_reason_check",
      sql`(${t.outcome} is not null and ${t.outcome} in ('skipped', 'failed')) = (${t.outcomeReason} is not null)`
    ),
    check(
      "email_campaign_automation_runs_trigger_check",
      sql`(${t.triggerKind} like 'reservation-%') = (${t.triggerReservationId} is not null)`
    ),
  ]
);

/**
 * A run's timeline. Entries record decisions (clause indices, definition
 * hashes, reason codes and instants), never the facts behind them.
 */
export const emailCampaignAutomationRunEvents = pgTable(
  "email_campaign_automation_run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => emailCampaignAutomationRuns.id, { onDelete: "cascade" })
      .$type<AutomationRunId>(),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull().$type<AutomationRunEventKind>(),
    stepId: text("step_id").$type<AutomationStepId>(),
    at: instant("at").notNull(),
    detail: jsonb("detail")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<AutomationRunEventDetail>(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.sequence] }),
    check(
      "email_campaign_automation_run_events_kind_check",
      sql`${t.kind} in (${quotedSqlList(automationRunEventKinds)})`
    ),
  ]
);

/**
 * One automation's handling of one trigger occurrence, keyed so that a
 * reservation event fires an automation at most once.
 */
export const emailCampaignAutomationTriggerReceipts = pgTable(
  "email_campaign_automation_trigger_receipts",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    /** `<kind>:<reservationId>`, `account-created:<accountId>` or `schedule:<fireAt>:<customerId>`. */
    dedupKey: text("dedup_key").notNull(),
    versionId: text("version_id").notNull().$type<AutomationVersionId>(),
    customerEventId: text("customer_event_id")
      .references(() => customerEvents.id, { onDelete: "set null" })
      .$type<CustomerEventId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    disposition: text("disposition")
      .notNull()
      .$type<AutomationTriggerDisposition>(),
    runId: text("run_id")
      .references(() => emailCampaignAutomationRuns.id)
      .$type<AutomationRunId>(),
    receivedAt: instant("received_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.dedupKey] }),
    foreignKey({
      name: "email_campaign_automation_trigger_receipts_version_fk",
      columns: [t.versionId, t.campaignId],
      foreignColumns: [
        emailCampaignAutomationVersions.id,
        emailCampaignAutomationVersions.campaignId,
      ],
    }),
    check(
      "email_campaign_automation_trigger_receipts_disposition_check",
      sql`${t.disposition} in (${quotedSqlList(automationTriggerDispositions)})`
    ),
    check(
      "email_campaign_automation_trigger_receipts_run_check",
      sql`(${t.disposition} = 'started') = (${t.runId} is not null)`
    ),
  ]
);

/** One schedule fire. Fires of one automation enter one at a time, in order. */
export const emailCampaignAutomationScheduleFires = pgTable(
  "email_campaign_automation_schedule_fires",
  {
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id)
      .$type<CampaignId>(),
    /** The scheduled time, and the trigger time of every run it starts. */
    fireAt: instant("fire_at").notNull(),
    /** The version in force at `fire_at`. */
    versionId: text("version_id").notNull().$type<AutomationVersionId>(),
    status: text("status").notNull().$type<AutomationScheduleFireStatus>(),
    chunksTotal: integer("chunks_total").notNull(),
    chunksDone: integer("chunks_done").notNull().default(0),
    /** Receipts written, started or already active. */
    enteredCount: integer("entered_count").notNull().default(0),
    settledAt: instant("settled_at"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.fireAt] }),
    foreignKey({
      name: "email_campaign_automation_schedule_fires_version_fk",
      columns: [t.versionId, t.campaignId],
      foreignColumns: [
        emailCampaignAutomationVersions.id,
        emailCampaignAutomationVersions.campaignId,
      ],
    }),
    uniqueIndex("email_campaign_automation_schedule_fires_one_open_idx")
      .on(t.campaignId)
      .where(sql`${t.status} = 'entering'`),
    check(
      "email_campaign_automation_schedule_fires_status_check",
      sql`${t.status} in (${quotedSqlList(automationScheduleFireStatuses)})`
    ),
    check(
      "email_campaign_automation_schedule_fires_settled_check",
      sql`(${t.status} = 'entering') = (${t.settledAt} is null)`
    ),
    check(
      "email_campaign_automation_schedule_fires_chunks_check",
      sql`${t.chunksDone} between 0 and ${t.chunksTotal}`
    ),
  ]
);

/** The engine heartbeat: a single row the migration seeds. */
export const emailCampaignAutomationEngine = pgTable(
  "email_campaign_automation_engine",
  {
    id: smallint("id").primaryKey(),
    lastPlannedAt: instant("last_planned_at"),
    lastPlanSummary: jsonb("last_plan_summary"),
  },
  (t) => [
    check("email_campaign_automation_engine_singleton_check", sql`${t.id} = 1`),
  ]
);

/** A dry run of one draft of an automation. */
export const emailCampaignAutomationPreviews = pgTable(
  "email_campaign_automation_previews",
  {
    id: text("id")
      .primaryKey()
      .default(postgresUuidV7)
      .$type<AutomationPreviewId>(),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => emailCampaigns.id, { onDelete: "cascade" })
      .$type<CampaignId>(),
    /** The working copy it evaluates. */
    draftHash: text("draft_hash").notNull(),
    kind: text("kind").notNull().$type<AutomationPreviewKind>(),
    status: text("status").notNull().$type<AutomationPreviewState>(),
    /** Replay: events in [as_of − 30 days, as_of). Schedule: the next fire. */
    asOf: instant("as_of").notNull(),
    unitsTotal: integer("units_total").notNull(),
    unitsDone: integer("units_done").notNull().default(0),
    /** Rows written per outcome; an outcome without rows may be absent. */
    counts: jsonb("counts")
      .notNull()
      .default(sql`'{}'::jsonb`)
      .$type<Partial<Record<AutomationPreviewOutcome, number>>>(),
    eventsTotal: integer("events_total"),
    errorCode: text("error_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    completedAt: instant("completed_at"),
  },
  (t) => [
    uniqueIndex("email_campaign_automation_previews_one_running_idx")
      .on(t.campaignId)
      .where(sql`${t.status} = 'running'`),
    index("email_campaign_automation_previews_created_idx").on(t.createdAt),
    check(
      "email_campaign_automation_previews_kind_check",
      sql`${t.kind} in (${quotedSqlList(automationPreviewKinds)})`
    ),
    check(
      "email_campaign_automation_previews_status_check",
      sql`${t.status} in (${quotedSqlList(automationPreviewStatuses)})`
    ),
  ]
);

/** A dry run's computed outcomes; names and emails are hydrated per response. */
export const emailCampaignAutomationPreviewRows = pgTable(
  "email_campaign_automation_preview_rows",
  {
    previewId: text("preview_id")
      .notNull()
      .references(() => emailCampaignAutomationPreviews.id, {
        onDelete: "cascade",
      })
      .$type<AutomationPreviewId>(),
    dotyposCustomerId: text("dotypos_customer_id")
      .notNull()
      .$type<DotyposCustomerId>(),
    /** The event's `occurred_at`, or the previewed fire. */
    triggerAt: instant("trigger_at").notNull(),
    customerEventId: text("customer_event_id").$type<CustomerEventId>(),
    outcome: text("outcome").notNull().$type<AutomationPreviewOutcome>(),
    stepId: text("step_id").$type<AutomationStepId>(),
    sendAt: instant("send_at"),
    projected: boolean("projected").notNull(),
    /** Read a reservation status the replay couldn't date then. */
    reservationStatusesApproximate: boolean("reservation_statuses_approximate")
      .notNull()
      .default(false),
  },
  (t) => [
    primaryKey({ columns: [t.previewId, t.dotyposCustomerId, t.triggerAt] }),
    check(
      "email_campaign_automation_preview_rows_outcome_check",
      sql`${t.outcome} in (${quotedSqlList(automationPreviewOutcomes)})`
    ),
  ]
);
