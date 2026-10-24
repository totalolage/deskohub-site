import { Array as Arr, Option, Order, Schema, Struct } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AdministrationOperationBehavior,
  destructiveOperation,
  readOperation,
  readPreview,
  writeOperation,
} from "./administration-operation";
import { ReservationProductFilter } from "./audience-attribute-kinds";
import {
  type AudienceCondition,
  AudienceFilter,
  type AudienceFilterOf,
  audienceAttributeCatalogue,
  makeAudienceFilterSchemas,
} from "./audience-filter";
import { CalendarExpression } from "./calendar-expression";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
} from "./campaign-identifiers";
import {
  AdministrationCampaignLocale,
  AdministrationCampaignPurpose,
} from "./campaign-locale-and-purpose";
import { DhwVersion, MinimumDhwVersion } from "./dhw-version";
import { emailAutomationScheduleMinutes } from "./email-automation-cadence";
import {
  AdministrationCampaignContent,
  AdministrationCampaignEmailPreview,
  AdministrationCampaignRecipientSkipReason,
  AdministrationCampaignSendId,
  AdministrationCampaignTemplateKey,
  campaignErrors,
} from "./email-campaigns";
import { fieldWithDefault, listField, nullableField } from "./response-fields";
import {
  AdministrationActionRecord,
  AdministrationAuthentication,
  AdministrationDotyposCustomerId,
  CliClientCompatibility,
} from "./workspace-admin-api";

/** Stable id of a flow step. A run's position is a step id, not an index. */
export const AutomationStepId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/)
)
  .pipe(Schema.brand("AutomationStepId"))
  .annotate({
    identifier: "AutomationStepId",
    description:
      "Stable id of a flow step, unique within the flow: lowercase letters, digits and hyphens, at most 32.",
  });
export type AutomationStepId = typeof AutomationStepId.Type;

/** The reservation product filter of a reservation trigger; audiences use the same schema. */
const reservationTriggerFields = {
  product: Schema.optionalKey(ReservationProductFilter),
};

/** What starts a run: a calendar schedule or one of five customer events. */
export const AutomationTrigger = Schema.Union([
  Schema.TaggedStruct("Schedule", { calendar: CalendarExpression }),
  Schema.TaggedStruct("ReservationBooked", reservationTriggerFields),
  Schema.TaggedStruct("ReservationCancelled", reservationTriggerFields),
  Schema.TaggedStruct("ReservationStarted", reservationTriggerFields),
  Schema.TaggedStruct("ReservationFinished", reservationTriggerFields),
  Schema.TaggedStruct("AccountCreated", {}),
]).annotate({
  identifier: "AutomationTrigger",
  description:
    "A Prague-time calendar schedule, or a reservation booked, cancelled, started or finished (optionally for one product), or an account created.",
});
export type AutomationTrigger = typeof AutomationTrigger.Type;

/**
 * The minutes past the hour a schedule's calendar fires on that the engine
 * doesn't tick on, ascending. A calendar without minutes fires on the hour.
 * Saving a flow rejects a schedule with any, so the Admin UI, the API and
 * dhw all apply this one rule.
 */
export const scheduleMinutesOffTick = (
  calendar: CalendarExpression
): readonly number[] =>
  Arr.sort(
    (calendar.minutes ?? [0]).filter(
      (minute) => !emailAutomationScheduleMinutes.includes(minute)
    ),
    Order.Number
  );

/**
 * "Is (not) in saved audience". It is evaluated against the audience's
 * current definition, so an audience edit takes effect without a new version.
 */
export const InSavedAudience = Schema.TaggedStruct("InAudience", {
  audienceId: AdministrationCampaignAudienceId,
  operator: Schema.Literals(["in", "notIn"]),
}).annotate({
  identifier: "InSavedAudience",
  description:
    "Whether the customer is (in) or isn't (notIn) in a saved audience, by its current definition.",
});
export type InSavedAudience = typeof InSavedAudience.Type;

/** A condition step's leaf: a catalogued attribute condition or saved-audience membership. */
export type AutomationConditionLeaf = AudienceCondition | InSavedAudience;
export type AutomationConditionFilter =
  AudienceFilterOf<AutomationConditionLeaf>;

/** A condition step's filter: the audience builder's AND/OR groups plus "in saved audience" leaves. */
export const AutomationConditionFilter: Schema.Codec<AutomationConditionFilter> =
  makeAudienceFilterSchemas(audienceAttributeCatalogue, {
    extraLeaves: [InSavedAudience],
  }).filter.annotate({
    identifier: "AutomationConditionFilter",
    description:
      "Nested AND/OR tree of audience attribute conditions and saved-audience membership.",
  });

export const automationDurationUnits = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
] as const;
export const AutomationDurationUnit = Schema.Literals(automationDurationUnits);
export type AutomationDurationUnit = typeof AutomationDurationUnit.Type;

/** A wait step: a relative delay, or until a calendar expression holds. */
export const AutomationWait = Schema.Union([
  Schema.TaggedStruct("Duration", {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 })),
    unit: AutomationDurationUnit,
  }),
  Schema.TaggedStruct("Calendar", { expression: CalendarExpression }),
]).annotate({ identifier: "AutomationWait" });
export type AutomationWait = typeof AutomationWait.Type;

export const AutomationStep = Schema.Union([
  Schema.TaggedStruct("Condition", {
    id: AutomationStepId,
    filter: AutomationConditionFilter,
  }),
  Schema.TaggedStruct("Wait", { id: AutomationStepId, wait: AutomationWait }),
  Schema.TaggedStruct("Send", { id: AutomationStepId }),
]).annotate({ identifier: "AutomationStep" });
export type AutomationStep = typeof AutomationStep.Type;

export const automationFlowMaxSteps = 20;

/**
 * One trigger and a single path of steps ending in exactly one send. Future
 * branches nest their own steps with their own ids, so runs, timelines and
 * receipts keep addressing steps by id.
 */
export const AutomationFlow = Schema.Struct({
  trigger: AutomationTrigger,
  steps: Schema.Array(AutomationStep),
})
  .check(
    Schema.makeFilter(
      ({ steps }) =>
        steps.length >= 1 && steps.length <= automationFlowMaxSteps,
      { description: `1–${automationFlowMaxSteps} steps.` }
    ),
    Schema.makeFilter(
      ({ steps }) =>
        steps.filter((step) => step._tag === "Send").length === 1 &&
        steps.at(-1)?._tag === "Send",
      { description: "Exactly one send step, and it is last." }
    ),
    Schema.makeFilter(
      ({ steps }) => new Set(steps.map(({ id }) => id)).size === steps.length,
      { description: "Step ids are unique." }
    )
  )
  .annotate({
    identifier: "AutomationFlow",
    description:
      "An automation's trigger and its steps: conditions and waits, ending in exactly one send.",
  });
export type AutomationFlow = typeof AutomationFlow.Type;

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const countField = fieldWithDefault(count, 0);

/** An ISO 8601 instant. */
const Instant = Schema.String;

const pageLimit = (maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));

export const AutomationVersionNumber = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1)
).annotate({
  identifier: "AutomationVersionNumber",
  description: "Number of a published version, counting from 1.",
});
export type AutomationVersionNumber = typeof AutomationVersionNumber.Type;

export const AutomationPreviewId = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationPreviewId")
).annotate({
  identifier: "AutomationPreviewId",
  description: "Database-generated identifier of one automation dry run.",
});
export type AutomationPreviewId = typeof AutomationPreviewId.Type;

export const AutomationRunId = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationRunId")
).annotate({
  identifier: "AutomationRunId",
  description:
    "Database-generated identifier of one customer's pass through an automation version.",
});
export type AutomationRunId = typeof AutomationRunId.Type;

/** A page cursor the server issued; opaque to clients. */
export const AutomationPageCursor = Schema.NonEmptyString.annotate({
  identifier: "AutomationPageCursor",
});

export const automationTriggerKinds = [
  "schedule",
  "reservation-booked",
  "reservation-cancelled",
  "reservation-started",
  "reservation-finished",
  "account-created",
] as const;
export const AutomationTriggerKind = Schema.Literals(automationTriggerKinds);
export type AutomationTriggerKind = typeof AutomationTriggerKind.Type;

export const AutomationStatus = Schema.Literals([
  "draft",
  "active",
  "paused",
  "archived",
]);
export type AutomationStatus = typeof AutomationStatus.Type;

/**
 * How often a schedule can fire: at most once per engine tick, so four times
 * an hour. Adapters warn when `firesMoreThanHourly` instead of computing it.
 */
export const AutomationFrequency = Schema.Struct({
  maxFiresPerHour: count,
  firesMoreThanHourly: Schema.Boolean,
}).annotate({ identifier: "AutomationFrequency" });
export type AutomationFrequency = typeof AutomationFrequency.Type;

/** A flow's trigger kind, with the frequency of a schedule trigger. */
export const AutomationTriggerSummary = Schema.Struct({
  kind: AutomationTriggerKind,
  /** Null unless the trigger is a schedule. */
  frequency: nullableField(AutomationFrequency),
});
export type AutomationTriggerSummary = typeof AutomationTriggerSummary.Type;

/**
 * Whether the working copy can be activated. Only `Ready` allows it: a
 * completed dry run of the current draft. `Published` means the working
 * copy equals the active version. Activation's own result stays
 * authoritative.
 */
export const AutomationActivation = Schema.Union([
  Schema.TaggedStruct("PreviewRequired", {}),
  Schema.TaggedStruct("PreviewRunning", {
    previewId: AutomationPreviewId,
    unitsDone: count,
    unitsTotal: count,
  }),
  Schema.TaggedStruct("Ready", {
    previewId: AutomationPreviewId,
    draftHash: Schema.String,
  }),
  Schema.TaggedStruct("Published", {}),
]).annotate({ identifier: "AutomationActivation" });
export type AutomationActivation = typeof AutomationActivation.Type;

export const AutomationVersionSummary = Schema.Struct({
  campaignId: AdministrationCampaignId,
  versionNumber: AutomationVersionNumber,
  trigger: AutomationTriggerSummary,
  draftHash: Schema.String,
  activatedAt: Instant,
  /** The saved audience the entry filter was copied from, while it exists. */
  audienceId: nullableField(AdministrationCampaignAudienceId),
  /** Null once the activating account is deleted. */
  activatedByEmail: nullableField(Schema.String),
  /** Whether this is the version new runs start on. */
  active: fieldWithDefault(Schema.Boolean, false),
});
export type AutomationVersionSummary = typeof AutomationVersionSummary.Type;

/** A published version: the frozen flow, content and entry filter. */
export const AutomationVersionDetail = Schema.Struct({
  ...AutomationVersionSummary.fields,
  flow: AutomationFlow,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  content: AdministrationCampaignContent,
  audienceFilter: AudienceFilter,
});
export type AutomationVersionDetail = typeof AutomationVersionDetail.Type;

/**
 * An automated campaign's lifecycle and working copy. Run data comes from
 * the run operations.
 */
export const AutomationDetail = Schema.Struct({
  campaignId: AdministrationCampaignId,
  status: AutomationStatus,
  /** The working copy; null until it is first saved. */
  flow: nullableField(AutomationFlow),
  /** The working copy's trigger; null while there is no flow. */
  trigger: nullableField(AutomationTriggerSummary),
  activeVersion: nullableField(AutomationVersionSummary),
  versionCount: countField,
  /** The working copy or campaign audience differs from the active version. */
  pendingChanges: fieldWithDefault(Schema.Boolean, false),
  activation: fieldWithDefault(AutomationActivation, {
    _tag: "PreviewRequired",
  }),
  acceptingSince: nullableField(Instant),
  pausedAt: nullableField(Instant),
  archivedAt: nullableField(Instant),
  /** Schedules only: the oldest fire not yet entered. */
  nextFireAt: nullableField(Instant),
  updatedAt: Instant,
});
export type AutomationDetail = typeof AutomationDetail.Type;

/** Replaces the working copy; a published version never changes. */
export const AutomationFlowUpdate = Schema.Struct({
  campaignId: AdministrationCampaignId,
  flow: AutomationFlow,
}).annotate(strictParseOptions);
export type AutomationFlowUpdate = typeof AutomationFlowUpdate.Type;

export const automationPreviewKinds = ["schedule", "replay"] as const;
export const AutomationPreviewKind = Schema.Literals(automationPreviewKinds);
export type AutomationPreviewKind = typeof AutomationPreviewKind.Type;

export const automationPreviewStatuses = [
  "running",
  "completed",
  "superseded",
  "failed",
] as const;
export const AutomationPreviewState = Schema.Literals(
  automationPreviewStatuses
);
export type AutomationPreviewState = typeof AutomationPreviewState.Type;

export const automationPreviewOutcomes = [
  "would-send",
  "condition-failed",
  "not-in-audience",
  "already-active",
  "withdrawn",
  "unavailable",
] as const;
export const AutomationPreviewOutcome = Schema.Literals(
  automationPreviewOutcomes
);
export type AutomationPreviewOutcome = typeof AutomationPreviewOutcome.Type;

/** A dry run's job: the draft it evaluates and its progress. */
export const AutomationPreviewStatus = Schema.Struct({
  previewId: AutomationPreviewId,
  campaignId: AdministrationCampaignId,
  draftHash: Schema.String,
  kind: AutomationPreviewKind,
  status: AutomationPreviewState,
  /** Replay: events before this instant; schedule: the next fire. */
  asOf: Instant,
  unitsDone: countField,
  unitsTotal: countField,
  /** Set when the status is `failed`. */
  errorCode: nullableField(Schema.String),
  createdAt: Instant,
  completedAt: nullableField(Instant),
});
export type AutomationPreviewStatus = typeof AutomationPreviewStatus.Type;

/** At most 200 rows per page. */
export const AutomationPreviewRef = Schema.Struct({
  previewId: AutomationPreviewId,
  cursor: Schema.optionalKey(AutomationPageCursor),
  limit: Schema.optionalKey(pageLimit(200)),
}).annotate(strictParseOptions);
export type AutomationPreviewRef = typeof AutomationPreviewRef.Type;

/** What one trigger occurrence would do for one customer. */
export const AutomationDryRunRow = Schema.Struct({
  triggerAt: Instant,
  customerId: AdministrationDotyposCustomerId,
  /** The replayed event; null for a schedule fire. */
  customerEventId: nullableField(Schema.String),
  outcome: AutomationPreviewOutcome,
  /** The step the simulation stopped at. */
  stepId: nullableField(AutomationStepId),
  /**
   * The engine tick the email would be sent on, for `would-send`. The
   * engine ticks every 15 minutes, so a send waits for the next one.
   */
  sendAt: nullableField(Instant),
  /** Evaluated after now, from facts as they are now. */
  projected: fieldWithDefault(Schema.Boolean, false),
  /**
   * Replay only: the outcome may differ because a reservation status read
   * for it changed since the trigger in a way Workspace can't date, such as
   * a cancellation in progress or failed, or a fulfillment that failed. It
   * read that status as it is now, or as it most likely was then. A row
   * that depends on such an earlier row of the customer carries the mark
   * too: an event its run may have held off (`already-active`) or let in,
   * and a later decision that counts this campaign's emails.
   */
  reservationStatusesApproximate: fieldWithDefault(Schema.Boolean, false),
});
export type AutomationDryRunRow = typeof AutomationDryRunRow.Type;

/** Name and email of a customer on the current page, read live. */
export const AutomationDryRunCustomer = Schema.Struct({
  customerId: AdministrationDotyposCustomerId,
  name: nullableField(Schema.String),
  email: nullableField(Schema.String),
});
export type AutomationDryRunCustomer = typeof AutomationDryRunCustomer.Type;

export const AutomationDryRunEmail = Schema.Struct({
  locale: AdministrationCampaignLocale,
  ...AdministrationCampaignEmailPreview.fields,
});
export type AutomationDryRunEmail = typeof AutomationDryRunEmail.Type;

/**
 * A dry run of the working copy against live audiences. A schedule
 * previews its next fires and who the first would enter; an event trigger
 * replays the last 30 days of events (at most 1,000). Rows and counts grow
 * as units complete.
 */
export const AutomationDryRun = Schema.Struct({
  ...AutomationPreviewStatus.fields,
  /** Schedules only: the next five fires of the working copy. */
  nextFires: listField(Instant),
  frequency: nullableField(AutomationFrequency),
  counts: fieldWithDefault(Schema.Record(AutomationPreviewOutcome, count), {
    "would-send": 0,
    "condition-failed": 0,
    "not-in-audience": 0,
    "already-active": 0,
    withdrawn: 0,
    unavailable: 0,
  }),
  /** Replay only: the events in the window, before truncation. */
  eventsTotal: nullableField(count),
  /** More events happened than the replay evaluates. */
  truncated: fieldWithDefault(Schema.Boolean, false),
  rows: listField(AutomationDryRunRow),
  nextCursor: nullableField(AutomationPageCursor),
  /** At most 200 customers of `rows`, hydrated live and never stored. */
  customers: listField(AutomationDryRunCustomer),
  /**
   * Conditions on tags, discount group, locale and consent used the
   * customers' current profile, not their profile at the trigger time.
   */
  profileFactsAreCurrent: fieldWithDefault(Schema.Boolean, true),
  /** The working copy's email in each covered locale. */
  emails: listField(AutomationDryRunEmail),
});
export type AutomationDryRun = typeof AutomationDryRun.Type;

/** Publishes the working copy that this completed dry run evaluated. */
export const AutomationActivateInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  previewId: AutomationPreviewId,
}).annotate(strictParseOptions);
export type AutomationActivateInput = typeof AutomationActivateInput.Type;

export const AutomationVersionRef = Schema.Struct({
  campaignId: AdministrationCampaignId,
  versionNumber: AutomationVersionNumber,
}).annotate(strictParseOptions);
export type AutomationVersionRef = typeof AutomationVersionRef.Type;

/**
 * An `active` run is at a step, `sending` is a recipient of a queued
 * batch, and an `ended` run has an outcome.
 */
export const automationRunStates = ["active", "sending", "ended"] as const;
export const AutomationRunState = Schema.Literals(automationRunStates);
export type AutomationRunState = typeof AutomationRunState.Type;

export const AutomationRunPhase = Schema.Literals(["ready", "waiting"]);
export type AutomationRunPhase = typeof AutomationRunPhase.Type;

/** `unconfirmed` may have reached the provider, so it counts as received. */
export const automationRunOutcomes = [
  "sent",
  "unconfirmed",
  "condition-failed",
  "skipped",
  "failed",
  "withdrawn",
  "archived",
] as const;
export const AutomationRunOutcome = Schema.Literals(automationRunOutcomes);
export type AutomationRunOutcome = typeof AutomationRunOutcome.Type;

export const AutomationRunFailureReason = Schema.Literals([
  "delivery-refused",
  "evaluation-unavailable",
]);
export type AutomationRunFailureReason = typeof AutomationRunFailureReason.Type;

export const AutomationRunStatsInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  versionNumber: Schema.optionalKey(AutomationVersionNumber),
}).annotate(strictParseOptions);
export type AutomationRunStatsInput = typeof AutomationRunStatsInput.Type;

const zeroRunStateCounts = { active: 0, sending: 0, ended: 0 };
const zeroRunOutcomeCounts = {
  sent: 0,
  unconfirmed: 0,
  "condition-failed": 0,
  skipped: 0,
  failed: 0,
  withdrawn: 0,
  archived: 0,
};
const runStateCounts = fieldWithDefault(
  Schema.Record(AutomationRunState, count),
  zeroRunStateCounts
);
const runOutcomeCounts = fieldWithDefault(
  Schema.Record(AutomationRunOutcome, count),
  zeroRunOutcomeCounts
);
const zeroSkipReasonCounts = {
  "missing-from-dotypos": 0,
  "deleted-customer": 0,
  "missing-email": 0,
  "invalid-email": 0,
  "consent-withdrawn": 0,
  "outside-test-domain": 0,
};

/** Run counts of all versions, or of one. */
export const AutomationRunStats = Schema.Struct({
  campaignId: AdministrationCampaignId,
  versionNumber: nullableField(AutomationVersionNumber),
  byState: runStateCounts,
  byOutcome: runOutcomeCounts,
  /** Per step: runs at it now, and runs that ended at it by outcome. */
  bySteps: listField(
    Schema.Struct({
      stepId: AutomationStepId,
      byState: runStateCounts,
      byOutcome: runOutcomeCounts,
    })
  ),
  /**
   * Skipped runs by why delivery skipped them. An older server omits it, so
   * it may not add up to `byOutcome.skipped`.
   */
  bySkipReason: fieldWithDefault(
    Schema.Record(AdministrationCampaignRecipientSkipReason, count),
    zeroSkipReasonCounts
  ),
});
export type AutomationRunStats = typeof AutomationRunStats.Type;

/** Newest runs first, at most 100 per page. */
export const AutomationRunListInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  state: Schema.optionalKey(AutomationRunState),
  stepId: Schema.optionalKey(AutomationStepId),
  outcome: Schema.optionalKey(AutomationRunOutcome),
  /** Skipped runs with this reason only. */
  skipReason: Schema.optionalKey(AdministrationCampaignRecipientSkipReason),
  versionNumber: Schema.optionalKey(AutomationVersionNumber),
  customerId: Schema.optionalKey(AdministrationDotyposCustomerId),
  cursor: Schema.optionalKey(AutomationPageCursor),
  limit: Schema.optionalKey(pageLimit(100)),
}).annotate(strictParseOptions);
export type AutomationRunListInput = typeof AutomationRunListInput.Type;

/**
 * Whether the run's customer profile was read from Dotypos: `found` (name
 * and email may still be empty), `not-found`, or `unavailable` when Dotypos
 * couldn't be read, or the server predates live contacts.
 */
export const AutomationRunCustomerProfileStatus = Schema.Literals([
  "found",
  "not-found",
  "unavailable",
]);
export type AutomationRunCustomerProfileStatus =
  typeof AutomationRunCustomerProfileStatus.Type;

export const AutomationRunSummary = Schema.Struct({
  runId: AutomationRunId,
  campaignId: AdministrationCampaignId,
  versionNumber: AutomationVersionNumber,
  customerId: AdministrationDotyposCustomerId,
  /** The customer's current name, read live and never stored. */
  customerName: nullableField(Schema.String),
  /**
   * The customer's current email, read live; not necessarily the address
   * a past send went to.
   */
  customerEmail: nullableField(Schema.String),
  customerProfileStatus: fieldWithDefault(
    AutomationRunCustomerProfileStatus,
    "unavailable"
  ),
  triggerKind: AutomationTriggerKind,
  triggerAt: Instant,
  state: AutomationRunState,
  /** Active runs only. */
  phase: nullableField(AutomationRunPhase),
  /** The current step; the last one once ended. */
  stepId: AutomationStepId,
  /** Active runs only. */
  dueAt: nullableField(Instant),
  outcome: nullableField(AutomationRunOutcome),
  /** A skip reason for `skipped`, a failure reason for `failed`. */
  outcomeReason: nullableField(Schema.String),
  sendId: nullableField(AdministrationCampaignSendId),
  startedAt: Instant,
  endedAt: nullableField(Instant),
});
export type AutomationRunSummary = typeof AutomationRunSummary.Type;

export const AutomationRunPage = Schema.Struct({
  runs: listField(AutomationRunSummary),
  nextCursor: nullableField(AutomationPageCursor),
});
export type AutomationRunPage = typeof AutomationRunPage.Type;

export const AutomationRunRef = Schema.Struct({
  runId: AutomationRunId,
}).annotate(strictParseOptions);
export type AutomationRunRef = typeof AutomationRunRef.Type;

export const automationRunEventKinds = [
  "started",
  "condition-passed",
  "condition-failed",
  "waiting",
  "woke",
  "deferred",
  "send-queued",
  "sent",
  "unconfirmed",
  "skipped",
  "failed",
  "withdrawn",
  "archived",
] as const;
export const AutomationRunEventKind = Schema.Literals(automationRunEventKinds);
export type AutomationRunEventKind = typeof AutomationRunEventKind.Type;

const noDetail = Schema.Struct({});

/**
 * The stored detail of each timeline entry kind. Entries record decisions
 * (clause indices, definition hashes, reasons and instants), never the
 * customer facts behind them.
 */
export const automationRunEventDetails = {
  started: noDetail,
  "condition-passed": noDetail,
  "condition-failed": Schema.Struct({
    /** Indices of the top-level clauses that didn't match. */
    failedConditions: Schema.Array(count),
    /** Each referenced saved audience's definition as evaluated. */
    savedAudiences: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          audienceId: AdministrationCampaignAudienceId,
          filterHash: Schema.String,
        })
      )
    ),
  }),
  waiting: Schema.Struct({ dueAt: Instant }),
  woke: noDetail,
  /** The triggering visit moved later; the send waits for it. */
  deferred: Schema.Struct({
    cause: Schema.Literal("trigger-not-reached"),
    recheckAt: Instant,
  }),
  "send-queued": Schema.Struct({ sendId: AdministrationCampaignSendId }),
  sent: noDetail,
  unconfirmed: noDetail,
  skipped: Schema.Struct({ reason: AdministrationCampaignRecipientSkipReason }),
  failed: Schema.Struct({ reason: AutomationRunFailureReason }),
  withdrawn: noDetail,
  archived: noDetail,
} satisfies Record<AutomationRunEventKind, Schema.Top>;
export type AutomationRunEventDetail<
  K extends AutomationRunEventKind = AutomationRunEventKind,
> = (typeof automationRunEventDetails)[K]["Type"];

const timelineEntryFields = {
  sequence: count,
  stepId: nullableField(AutomationStepId),
  at: Instant,
};

const knownTimelineEntry = <K extends AutomationRunEventKind>(kind: K) =>
  Schema.Struct({
    ...timelineEntryFields,
    kind: Schema.Literal(kind),
    detail: automationRunEventDetails[kind],
  });

/**
 * One timeline entry. An entry of a kind this client doesn't know, or with
 * a detail it can't read, decodes as a generic entry.
 */
export const AutomationRunTimelineEntry = Schema.Union([
  ...automationRunEventKinds.map(knownTimelineEntry),
  Schema.Struct({
    ...timelineEntryFields,
    kind: Schema.String,
    detail: fieldWithDefault(Schema.Record(Schema.String, Schema.Unknown), {}),
  }),
]).annotate({ identifier: "AutomationRunTimelineEntry" });
export type AutomationRunTimelineEntry = typeof AutomationRunTimelineEntry.Type;

export const AutomationRunDetail = Schema.Struct({
  ...AutomationRunSummary.fields,
  timeline: listField(AutomationRunTimelineEntry),
});
export type AutomationRunDetail = typeof AutomationRunDetail.Type;

export const CalendarExpressionUsage = Schema.Literals(["trigger", "wait"]);
export type CalendarExpressionUsage = typeof CalendarExpressionUsage.Type;

/** Describes an expression as a schedule trigger or a wait step would use it. */
export const CalendarPreviewInput = Schema.Struct({
  expression: CalendarExpression,
  usage: CalendarExpressionUsage,
  locale: AdministrationCampaignLocale,
}).annotate(strictParseOptions);
export type CalendarPreviewInput = typeof CalendarPreviewInput.Type;

export const CalendarPreview = Schema.Struct({
  description: Schema.String,
  /** The next five period starts, Prague time, as instants. */
  nextStarts: listField(Instant),
  frequency: AutomationFrequency,
});
export type CalendarPreview = typeof CalendarPreview.Type;

/** Engine health: lags, backlogs and unit durations, never customer data. */
export const AutomationEngineHealth = Schema.Struct({
  lastPlannedAt: nullableField(Instant),
  /** How far the started/finished sweep trails now. */
  sweepLagSeconds: nullableField(Schema.Finite),
  oldestUnprocessedEventAt: nullableField(Instant),
  automations: listField(
    Schema.Struct({
      campaignId: AdministrationCampaignId,
      /** How far the oldest fire not yet entered trails now. */
      scheduleLagSeconds: nullableField(Schema.Finite),
      enteringFire: nullableField(
        Schema.Struct({
          fireAt: Instant,
          chunksDone: count,
          chunksTotal: count,
        })
      ),
      lastFire: nullableField(
        Schema.Struct({
          fireAt: Instant,
          durationSeconds: Schema.Finite,
          intervalSeconds: nullableField(Schema.Finite),
          /** The fire took longer than the interval to the next one. */
          fallingBehind: Schema.Boolean,
        })
      ),
    })
  ),
  unitDurations: listField(
    Schema.Struct({
      kind: Schema.String,
      samples: count,
      meanSeconds: Schema.Finite,
      maxSeconds: Schema.Finite,
    })
  ),
  units: listField(
    Schema.Struct({ kind: Schema.String, status: Schema.String, count })
  ),
  oldestPlannedUnitAt: nullableField(Instant),
  retryingUnits: listField(
    Schema.Struct({
      kind: Schema.String,
      errorCode: nullableField(Schema.String),
      count,
    })
  ),
  deadlineMisses: countField,
  /** The most bookings one customer has, against the solo-unit threshold. */
  largestCustomerBookedCount: nullableField(count),
  soloThreshold: nullableField(count),
  /** Codes of the conditions the run log warns about. */
  warnings: listField(
    Schema.Literals([
      "planner-stale",
      "sweep-lagging",
      "event-backlog",
      "unit-backlog",
      "schedule-lagging",
      "falling-behind",
    ])
  ),
});
export type AutomationEngineHealth = typeof AutomationEngineHealth.Type;

/**
 * The first `dhw` release with the `automations` and `calendar` commands.
 * Older binaries can't decode a flow, so every automation operation, reads
 * included, requires it.
 */
export const automationsMinimumDhwVersion = DhwVersion.make("1.24.0");

/** An input without its path parameters: what an endpoint's body or query carries. */
const withoutPathParams = <
  Fields extends Schema.Struct.Fields,
  const Keys extends ReadonlyArray<keyof Fields>,
>(
  input: Schema.Struct<Fields>,
  keys: Keys
) => input.mapFields(Struct.omit(keys)).annotate(strictParseOptions);

const automationParams = { campaignId: AdministrationCampaignId };
const automationVersionParams = {
  campaignId: AdministrationCampaignId,
  versionNumber: AutomationVersionNumber,
};

export const AdminCliAutomationsApi = HttpApiGroup.make("automations")
  .add(
    HttpApiEndpoint.get("getAutomation", "/automations/:campaignId/flow", {
      params: automationParams,
      success: AutomationDetail,
      error: campaignErrors,
    }).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.put(
      "updateAutomationFlow",
      "/automations/:campaignId/flow",
      {
        params: automationParams,
        payload: withoutPathParams(AutomationFlowUpdate, ["campaignId"]),
        success: AutomationDetail,
        error: campaignErrors,
      }
    ).annotate(
      AdministrationOperationBehavior,
      writeOperation({ idempotent: true })
    )
  )
  .add(
    HttpApiEndpoint.post(
      "dryRunAutomation",
      "/automations/:campaignId/dry-run",
      {
        params: automationParams,
        success: AutomationPreviewStatus,
        error: campaignErrors,
      }
    ).annotate(
      AdministrationOperationBehavior,
      writeOperation({ idempotent: false })
    )
  )
  .add(
    HttpApiEndpoint.get(
      "getAutomationDryRun",
      "/automation-dry-runs/:previewId",
      {
        params: { previewId: AutomationPreviewId },
        query: withoutPathParams(AutomationPreviewRef, ["previewId"]),
        success: AutomationDryRun,
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.post(
      "activateAutomation",
      "/automations/:campaignId/activate",
      {
        params: automationParams,
        payload: withoutPathParams(AutomationActivateInput, ["campaignId"]),
        success: AutomationVersionSummary,
        error: campaignErrors,
      }
    ).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      })
    )
  )
  .add(
    HttpApiEndpoint.post("pauseAutomation", "/automations/:campaignId/pause", {
      params: automationParams,
      success: AutomationDetail,
      error: campaignErrors,
    }).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      })
    )
  )
  .add(
    HttpApiEndpoint.post(
      "resumeAutomation",
      "/automations/:campaignId/resume",
      {
        params: automationParams,
        success: AutomationDetail,
        error: campaignErrors,
      }
    ).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      })
    )
  )
  .add(
    HttpApiEndpoint.post(
      "archiveAutomation",
      "/automations/:campaignId/archive",
      {
        params: automationParams,
        success: AutomationDetail,
        error: campaignErrors,
      }
    ).annotate(
      AdministrationOperationBehavior,
      destructiveOperation({
        idempotent: true,
        preview: readPreview("automations.getAutomation"),
      })
    )
  )
  .add(
    HttpApiEndpoint.get(
      "listAutomationVersions",
      "/automations/:campaignId/versions",
      {
        params: automationParams,
        success: Schema.Array(AutomationVersionSummary),
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.get(
      "getAutomationVersion",
      "/automations/:campaignId/versions/:versionNumber",
      {
        params: automationVersionParams,
        success: AutomationVersionDetail,
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.get(
      "getAutomationRunStats",
      "/automations/:campaignId/runs/stats",
      {
        params: automationParams,
        query: withoutPathParams(AutomationRunStatsInput, ["campaignId"]),
        success: AutomationRunStats,
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.get("listAutomationRuns", "/automations/:campaignId/runs", {
      params: automationParams,
      query: withoutPathParams(AutomationRunListInput, ["campaignId"]),
      success: AutomationRunPage,
      error: campaignErrors,
    }).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.get("getAutomationRun", "/automation-runs/:runId", {
      params: { runId: AutomationRunId },
      success: AutomationRunDetail,
      error: campaignErrors,
    }).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.post(
      "previewCalendarExpression",
      "/calendar-expressions/preview",
      {
        payload: CalendarPreviewInput,
        success: CalendarPreview,
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .add(
    HttpApiEndpoint.get(
      "getAutomationEngineHealth",
      "/automations/engine-health",
      {
        success: AutomationEngineHealth,
        error: campaignErrors,
      }
    ).annotate(AdministrationOperationBehavior, readOperation)
  )
  .annotate(MinimumDhwVersion, Option.some(automationsMinimumDhwVersion))
  .middleware(AdministrationActionRecord)
  .middleware(AdministrationAuthentication)
  // Added last, so it runs first, as in the campaigns group.
  .middleware(CliClientCompatibility)
  .prefix("/api/v1/cli");
