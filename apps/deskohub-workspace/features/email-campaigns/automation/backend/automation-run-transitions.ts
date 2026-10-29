import "server-only";

import type { AutomationRunEventDetail } from "@deskohub/workspace-admin-api";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Match } from "effect";
import {
  type WorkspaceDatabaseClient,
  WorkspaceTransaction,
} from "@/db/database.service";
import { emailCampaignAutomationRuns } from "@/db/schema";
import type { CampaignRecipientSkipReason } from "../../campaign-states";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import type {
  AutomationRunFailureReason,
  AutomationRunPhase,
} from "../automation-states";
import {
  type AutomationRunEndingEntry,
  appendAutomationRunEndings,
} from "./automation-run-timeline";

/**
 * How runs end. `skipped` and `failed` carry their reason, which is also
 * the entry's detail; `condition-failed` carries the evaluation's detail.
 */
export type AutomationRunEnding =
  | {
      readonly outcome: "skipped";
      readonly reason: CampaignRecipientSkipReason;
    }
  | {
      readonly outcome: "failed";
      readonly reason: AutomationRunFailureReason;
    }
  | {
      readonly outcome: "condition-failed";
      readonly detail: AutomationRunEventDetail<"condition-failed">;
    }
  | {
      readonly outcome: "sent" | "unconfirmed" | "withdrawn" | "archived";
    };

/**
 * The state the caller read the runs in. A run that has moved on since
 * isn't ended.
 */
export type AutomationRunExpectation =
  | {
      readonly status: "active";
      readonly stepId?: AutomationStepId;
      readonly phase?: AutomationRunPhase;
      readonly workUnitId?: AutomationWorkUnitId | null;
    }
  | {
      readonly status: "sending";
      readonly stepId?: AutomationStepId;
      readonly workUnitId?: AutomationWorkUnitId | null;
    };

export type AutomationRunEnd = AutomationRunEnding & {
  readonly runIds: readonly AutomationRunId[];
  readonly expect: AutomationRunExpectation;
  readonly at: Temporal.Instant;
};

/**
 * The one way a run ends. No other code writes `status = 'ended'` (the
 * `automation-state-writers` Grit rule).
 */
export const AutomationRunTransitions = {
  /**
   * Ends the runs still in `expect` with one compare-and-set, records one
   * timeline entry per run it ended, and returns those runs. Runs CAS in
   * the lock order of §5.4: after the lifecycle lock and any triggering
   * reservations, before sends, recipients, batches and units.
   */
  end: Effect.fn("AutomationRunTransitions.end")(function* (
    input: AutomationRunEnd
  ) {
    const { db } = yield* WorkspaceTransaction;
    const recorded = endingRecord(input);
    const ended = yield* db
      .update(emailCampaignAutomationRuns)
      .set({
        status: "ended",
        phase: null,
        dueAt: null,
        outcome: input.outcome,
        outcomeReason: recorded.reason,
        endedAt: input.at,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(
            emailCampaignAutomationRuns.id,
            lockedInIdOrder(db, input.runIds, input.expect)
          ),
          expectationCondition(input.expect)
        )
      )
      .returning({
        runId: emailCampaignAutomationRuns.id,
        stepId: emailCampaignAutomationRuns.stepId,
      });
    yield* appendAutomationRunEndings(
      ended.map((run) => recorded.entry({ ...run, at: input.at }))
    );
    return ended.map((run): AutomationRunId => run.runId);
  }),
};

type EndedRun = {
  readonly runId: AutomationRunId;
  readonly stepId: AutomationStepId;
  readonly at: Temporal.Instant;
};

/** The reason column and the timeline entry an ending records. */
const endingRecord = (
  ending: AutomationRunEnding
): {
  readonly reason:
    | CampaignRecipientSkipReason
    | AutomationRunFailureReason
    | null;
  readonly entry: (run: EndedRun) => AutomationRunEndingEntry;
} =>
  Match.value(ending).pipe(
    Match.discriminatorsExhaustive("outcome")({
      skipped: ({ reason }) => ({
        reason,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "skipped",
          detail: { reason },
        }),
      }),
      failed: ({ reason }) => ({
        reason,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "failed",
          detail: { reason },
        }),
      }),
      "condition-failed": ({ detail }) => ({
        reason: null,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "condition-failed",
          detail,
        }),
      }),
      sent: () => ({
        reason: null,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "sent",
        }),
      }),
      unconfirmed: () => ({
        reason: null,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "unconfirmed",
        }),
      }),
      withdrawn: () => ({
        reason: null,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "withdrawn",
        }),
      }),
      archived: () => ({
        reason: null,
        entry: (run: EndedRun): AutomationRunEndingEntry => ({
          ...run,
          kind: "archived",
        }),
      }),
    })
  );

/**
 * The runs still in `expect`, row-locked in id order (§5.4) within the
 * ending statement, so two transactions ending overlapping runs can't
 * deadlock. The outer statement rechecks `expect` after any lock wait.
 */
const lockedInIdOrder = (
  db: Pick<WorkspaceDatabaseClient, "select">,
  runIds: readonly AutomationRunId[],
  expect: AutomationRunExpectation
) =>
  db
    .select({ id: emailCampaignAutomationRuns.id })
    .from(emailCampaignAutomationRuns)
    .where(
      and(
        inArray(emailCampaignAutomationRuns.id, [...runIds]),
        expectationCondition(expect)
      )
    )
    .orderBy(emailCampaignAutomationRuns.id)
    .for("update");

const expectationCondition = (expect: AutomationRunExpectation) =>
  and(
    eq(emailCampaignAutomationRuns.status, expect.status),
    expect.stepId === undefined
      ? undefined
      : eq(emailCampaignAutomationRuns.stepId, expect.stepId),
    "phase" in expect && expect.phase !== undefined
      ? eq(emailCampaignAutomationRuns.phase, expect.phase)
      : undefined,
    expect.workUnitId === undefined
      ? undefined
      : workUnitCondition(expect.workUnitId)
  );

const workUnitCondition = (workUnitId: AutomationWorkUnitId | null) =>
  workUnitId === null
    ? isNull(emailCampaignAutomationRuns.workUnitId)
    : eq(emailCampaignAutomationRuns.workUnitId, workUnitId);
