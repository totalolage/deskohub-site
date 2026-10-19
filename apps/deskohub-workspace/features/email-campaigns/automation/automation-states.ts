import { Schema } from "effect";

/** What starts a run: a schedule fire or one customer event kind. */
export const automationTriggerKinds = [
  "schedule",
  "reservation-booked",
  "reservation-cancelled",
  "reservation-started",
  "reservation-finished",
  "account-created",
] as const;
const automationTriggerKindSchema = Schema.Literals(automationTriggerKinds);
export type AutomationTriggerKind = typeof automationTriggerKindSchema.Type;

/**
 * An `active` run is at a step, `ready` for the engine or `waiting` until
 * its due time. A `sending` run is a recipient of a persisted batch. An
 * `ended` run has an outcome.
 */
const automationRunStatuses = ["active", "sending", "ended"] as const;
const automationRunStatusSchema = Schema.Literals(automationRunStatuses);
export type AutomationRunStatus = typeof automationRunStatusSchema.Type;

const automationRunPhases = ["ready", "waiting"] as const;
const automationRunPhaseSchema = Schema.Literals(automationRunPhases);
export type AutomationRunPhase = typeof automationRunPhaseSchema.Type;

/**
 * How a run ended. `unconfirmed` may have reached the provider, so it
 * counts as received. `skipped` and `failed` carry a reason.
 */
export const automationRunOutcomes = [
  "sent",
  "unconfirmed",
  "condition-failed",
  "skipped",
  "failed",
  "withdrawn",
  "archived",
] as const;
const automationRunOutcomeSchema = Schema.Literals(automationRunOutcomes);
export type AutomationRunOutcome = typeof automationRunOutcomeSchema.Type;

/** Why a run ended `failed`; `skipped` reuses the recipient skip reasons. */
const automationRunFailureReasons = [
  "delivery-refused",
  "evaluation-unavailable",
] as const;
const automationRunFailureReasonSchema = Schema.Literals(
  automationRunFailureReasons
);
export type AutomationRunFailureReason =
  typeof automationRunFailureReasonSchema.Type;

/** Kinds of a run's timeline entries. */
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
const automationRunEventKindSchema = Schema.Literals(automationRunEventKinds);
export type AutomationRunEventKind = typeof automationRunEventKindSchema.Type;

/** What one automation did with one trigger occurrence. */
export const automationTriggerDispositions = [
  "started",
  "already-active",
  "not-in-audience",
  "withdrawn",
  "failed",
] as const;
const automationTriggerDispositionSchema = Schema.Literals(
  automationTriggerDispositions
);
export type AutomationTriggerDisposition =
  typeof automationTriggerDispositionSchema.Type;

/**
 * A schedule fire is `entering` while its chunks run, then `entered`.
 * Pause or archive `dropped` it; `failed` is a non-retryable defect.
 */
export const automationScheduleFireStatuses = [
  "entering",
  "entered",
  "dropped",
  "failed",
] as const;
const automationScheduleFireStatusSchema = Schema.Literals(
  automationScheduleFireStatuses
);
export type AutomationScheduleFireStatus =
  typeof automationScheduleFireStatusSchema.Type;

export const automationPreviewKinds = ["schedule", "replay"] as const;
const automationPreviewKindSchema = Schema.Literals(automationPreviewKinds);
export type AutomationPreviewKind = typeof automationPreviewKindSchema.Type;

export const automationPreviewStatuses = [
  "running",
  "completed",
  "superseded",
  "failed",
] as const;
const automationPreviewStatusSchema = Schema.Literals(
  automationPreviewStatuses
);
export type AutomationPreviewStatus = typeof automationPreviewStatusSchema.Type;

export const automationPreviewOutcomes = [
  "would-send",
  "condition-failed",
  "not-in-audience",
  "already-active",
  "withdrawn",
  "unavailable",
] as const;
const automationPreviewOutcomeSchema = Schema.Literals(
  automationPreviewOutcomes
);
export type AutomationPreviewOutcome =
  typeof automationPreviewOutcomeSchema.Type;
