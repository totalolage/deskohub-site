import { Schema } from "effect";

/**
 * Run, timeline and dry-run states the admin contract publishes. Workspace
 * stores the same values, so it uses the contract's lists.
 */
export {
  type AutomationPreviewKind,
  type AutomationPreviewOutcome,
  type AutomationPreviewState,
  type AutomationRunEventKind,
  type AutomationRunFailureReason,
  type AutomationRunOutcome,
  type AutomationRunPhase,
  type AutomationRunState,
  type AutomationTriggerKind,
  automationPreviewKinds,
  automationPreviewOutcomes,
  automationPreviewStatuses,
  automationRunEventKinds,
  automationRunOutcomes,
  automationTriggerKinds,
} from "@deskohub/workspace-admin-api";

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
