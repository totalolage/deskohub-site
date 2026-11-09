import "server-only";

import type { AutomationRunEventDetail } from "@deskohub/workspace-admin-api";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { emailCampaignAutomationRunEvents } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type {
  AutomationRunId,
  AutomationStepId,
} from "../automation-identifiers";
import type {
  AutomationRunEventKind,
  AutomationRunOutcome,
} from "../automation-states";

/**
 * Kinds a run records while it is open. An ended run's entry, whose kind is
 * its outcome, is written only by `AutomationRunTransitions.end`.
 */
type AutomationRunProgressKind = Exclude<
  AutomationRunEventKind,
  AutomationRunOutcome
>;

/** A detail is optional for the kinds whose detail is empty. */
type DetailOf<K extends AutomationRunEventKind> =
  object extends AutomationRunEventDetail<K>
    ? { readonly detail?: AutomationRunEventDetail<K> }
    : { readonly detail: AutomationRunEventDetail<K> };

/** One timeline entry to append, of kind `K`. */
type TimelineEntryInput<K extends AutomationRunEventKind> = {
  [Kind in K]: {
    readonly runId: AutomationRunId;
    readonly kind: Kind;
    readonly stepId: AutomationStepId | null;
    readonly at: Temporal.Instant;
  } & DetailOf<Kind>;
}[K];

/**
 * An open run's progress: it started, passed a condition, waited, woke,
 * deferred its send or queued it.
 */
export type AutomationRunProgressEntry =
  TimelineEntryInput<AutomationRunProgressKind>;

/** The entry an ended run records; its kind is the run's outcome. */
export type AutomationRunEndingEntry = TimelineEntryInput<AutomationRunOutcome>;

/**
 * Appends one entry per run at the run's `max(sequence) + 1` (the first is
 * 1). Call it in the transaction that changes those runs, after the run's
 * compare-and-set or insert: the row lock that write holds serialises the
 * sequence. A run appears at most once per call.
 */
export const appendAutomationRunProgress = (
  entries: readonly AutomationRunProgressEntry[]
) => appendTimelineEntries(entries);

/**
 * Appends ended runs' entries like `appendAutomationRunProgress`. Only
 * `AutomationRunTransitions.end` calls it, in the statement pair that ends
 * the runs (the `automation-state-writers` Grit rule).
 */
export const appendAutomationRunEndings = (
  entries: readonly AutomationRunEndingEntry[]
) => appendTimelineEntries(entries);

const appendTimelineEntries = (
  entries: readonly TimelineEntryInput<AutomationRunEventKind>[]
): Effect.Effect<void, DatabaseQueryError, WorkspaceTransaction> =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    Effect.suspend(() =>
      db.insert(emailCampaignAutomationRunEvents).values(
        entries.map((entry) => ({
          runId: entry.runId,
          sequence: nextSequence(entry.runId),
          kind: entry.kind,
          stepId: entry.stepId,
          at: entry.at,
          detail: entry.detail ?? {},
        }))
      )
    ).pipe(Effect.when(Effect.succeed(entries.length > 0)), Effect.asVoid)
  );

const nextSequence = (runId: AutomationRunId) =>
  sql<number>`(select coalesce(max(${emailCampaignAutomationRunEvents.sequence}), 0) + 1 from ${emailCampaignAutomationRunEvents} where ${emailCampaignAutomationRunEvents.runId} = ${runId})`;
