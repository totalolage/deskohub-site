import { Data, type Schema } from "effect";
import type { CalendarExpressionNeverOccurs } from "@/shared/utils/calendar-expression";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import type { AutomatedCampaignStatus } from "../campaign-states";
import type {
  AutomationPreviewId,
  AutomationRunId,
  AutomationStepId,
} from "./automation-identifiers";

/**
 * Where in a flow a rule failed: the trigger, or a step by its id. Messages
 * name it, so the operator can find the step to fix.
 */
export type AutomationFlowLocation =
  | { readonly _tag: "Trigger" }
  | { readonly _tag: "Step"; readonly stepId: AutomationStepId };

/**
 * The flow fails Workspace's flow schema, such as an unknown product
 * property, or a domain rule, such as a wait longer than a year. The message
 * is English, actionable, and holds no customer data.
 */
export class AutomationFlowInvalid extends Data.TaggedError(
  "AutomationFlowInvalid"
)<{
  readonly message: string;
  readonly location?: AutomationFlowLocation;
  readonly cause?: Schema.SchemaError;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "flow-invalid";
}

/**
 * A calendar of the flow, the schedule trigger's or a wait step's, has no
 * period start within the eight-year horizon.
 */
export class AutomationCalendarNeverOccurs extends Data.TaggedError(
  "AutomationCalendarNeverOccurs"
)<{
  readonly location: AutomationFlowLocation;
  readonly cause: CalendarExpressionNeverOccurs;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "calendar-never-occurs";
}

/**
 * The schedule trigger fires on minutes the engine doesn't tick on: it ticks
 * every 15 minutes, so a schedule may fire only at :00, :15, :30 and :45
 * (D36). `minutes` are the offending minutes past the hour, ascending.
 */
export class AutomationScheduleMinutesNotAllowed extends Data.TaggedError(
  "AutomationScheduleMinutesNotAllowed"
)<{
  readonly minutes: readonly number[];
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "schedule-minutes-not-allowed";
}

/**
 * Activation needs a completed dry run of this campaign's current draft:
 * the named dry run is missing, belongs to another campaign, or hasn't
 * completed (D6, D20).
 */
export class AutomationPreviewRequired extends Data.TaggedError(
  "AutomationPreviewRequired"
)<{
  readonly campaignId: CampaignId;
  readonly previewId: AutomationPreviewId;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "automation-preview-required";
}

/** No dry run has this id, or housekeeping removed it a day after it started. */
export class AutomationPreviewNotFound extends Data.TaggedError(
  "AutomationPreviewNotFound"
)<{
  readonly previewId: AutomationPreviewId;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "automation-preview-not-found";
}

/**
 * The working copy or the campaign audience changed after the dry run, so
 * the dry run no longer describes what activation would publish.
 */
export class AutomationDraftChanged extends Data.TaggedError(
  "AutomationDraftChanged"
)<{
  readonly campaignId: CampaignId;
  readonly previewId: AutomationPreviewId;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "automation-draft-changed";
}

/** An archived automation has ended for good; duplicate it to start again. */
export class AutomationArchived extends Data.TaggedError("AutomationArchived")<{
  readonly campaignId: CampaignId;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "automation-archived";
}

/**
 * A lifecycle transition the automation's status doesn't allow, such as
 * pausing a draft or resuming an active automation.
 */
export class AutomationStatusConflict extends Data.TaggedError(
  "AutomationStatusConflict"
)<{
  readonly campaignId: CampaignId;
  readonly operation: "pause" | "resume";
  readonly status: AutomatedCampaignStatus;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "automation-status-conflict";
}

/** The automation has no published version with this number. */
export class AutomationVersionNotFound extends Data.TaggedError(
  "AutomationVersionNotFound"
)<{
  readonly campaignId: CampaignId;
  readonly versionNumber: number;
}> {}

/** No automation run has this id. */
export class AutomationRunNotFound extends Data.TaggedError(
  "AutomationRunNotFound"
)<{
  readonly runId: AutomationRunId;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "automation-run-not-found";
}

/**
 * A page cursor this server didn't issue, or one an older build issued in
 * another format. Start again from the first page.
 */
export class AutomationPageCursorInvalid extends Data.TaggedError(
  "AutomationPageCursorInvalid"
)<{
  readonly cause: Schema.SchemaError;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "automation-page-cursor-invalid";
}

/**
 * A condition references a saved audience that no longer exists. It can't
 * pass again, so the condition unit ends its runs failed (evaluation
 * unavailable) instead of retrying.
 */
export class AutomationConditionAudienceMissing extends Data.TaggedError(
  "AutomationConditionAudienceMissing"
)<{
  readonly audienceId: CampaignAudienceId;
}> {
  /** Stable across transports, so clients can tell this failure apart. */
  static readonly code = "audience-missing";
}
