import "server-only";

import { and, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { emailCampaignAutomationRuns as runs } from "@/db/schema";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationWorkUnitId,
} from "../automation-identifiers";
import type { AutomationRunPhase } from "../automation-states";
import {
  type AutomationRunProgressEntry,
  appendAutomationRunProgress,
} from "./automation-run-timeline";
import type { AutomationEngineTransaction } from "./automation-unit-handler";

/*
 * How an open run moves through its flow. Each move is a compare-and-set on
 * the run as the caller read it, `(id, status, step_id, phase,
 * work_unit_id)` (§5.4), plus one timeline entry per run it moved. Runs
 * end only through `AutomationRunTransitions.end`.
 */

/** An active run's position as the caller read it. A run that has moved on since isn't moved. */
export type AutomationRunPosition = {
  readonly runId: AutomationRunId;
  readonly stepId: AutomationStepId;
  readonly phase: AutomationRunPhase;
};

type AutomationRunMove = {
  readonly position: AutomationRunPosition;
  readonly stepId: AutomationStepId;
  readonly phase: AutomationRunPhase;
  readonly dueAt: Temporal.Instant;
  /** None keeps the run's `step_entered_at`. */
  readonly stepEnteredAt: Option.Option<Temporal.Instant>;
  readonly entry: AutomationRunProgressEntry;
};

/**
 * Moves the runs still where the caller read them and still owned by
 * `workUnitId` (null: by no unit), clears their owner, and records each
 * move's entry. Runs lock in id order (§5.4). Returns the runs moved.
 */
const moveAutomationRuns = Effect.fn("automationRuns.move")(function* (
  tx: AutomationEngineTransaction,
  input: {
    readonly moves: readonly AutomationRunMove[];
    readonly workUnitId: AutomationWorkUnitId | null;
  }
) {
  if (input.moves.length === 0) return [];

  const byRun = (value: (move: AutomationRunMove) => SQL) =>
    sql`case ${runs.id} ${sql.join(
      input.moves.map(
        (move) => sql`when ${move.position.runId} then ${value(move)}`
      ),
      sql` `
    )} end`;
  const instant = (value: Temporal.Instant) =>
    sql`${sql.param(value, runs.dueAt)}::timestamptz`;
  const owned = and(
    eq(runs.status, "active"),
    input.workUnitId === null
      ? isNull(runs.workUnitId)
      : eq(runs.workUnitId, input.workUnitId)
  );
  const lockedInIdOrder = tx
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        inArray(
          runs.id,
          input.moves.map((move) => move.position.runId)
        ),
        owned
      )
    )
    .orderBy(runs.id)
    .for("update");

  const moved = yield* tx
    .update(runs)
    .set({
      stepId: byRun((move) => sql`${move.stepId}`),
      phase: byRun((move) => sql`${move.phase}`),
      dueAt: byRun((move) => instant(move.dueAt)),
      stepEnteredAt: byRun((move) =>
        Option.match(move.stepEnteredAt, {
          onNone: () => sql`${runs.stepEnteredAt}`,
          onSome: instant,
        })
      ),
      workUnitId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        inArray(runs.id, lockedInIdOrder),
        owned,
        sql`${runs.stepId} = ${byRun((move) => sql`${move.position.stepId}`)}`,
        sql`${runs.phase} = ${byRun((move) => sql`${move.position.phase}`)}`
      )
    )
    .returning({ runId: runs.id });

  const movedIds = new Set(moved.map(({ runId }) => runId));
  yield* appendAutomationRunProgress(
    tx,
    input.moves
      .filter((move) => movedIds.has(move.position.runId))
      .map((move) => move.entry)
  );
  return moved.map(({ runId }) => runId);
});

/**
 * Advances runs to their next step: `step_id ← next`, `phase = 'ready'`,
 * `due_at = step_entered_at = at`, no owner, so the planner step for the
 * next step's kind picks them up. The entry records the step left: `woke`
 * for a wait, `condition-passed` for a condition. `workUnitId` is the unit
 * that owns the runs, or null for the planner's timers.
 */
export const advanceAutomationRuns = (
  tx: AutomationEngineTransaction,
  input: {
    readonly runs: readonly (AutomationRunPosition & {
      readonly nextStepId: AutomationStepId;
      readonly passed: "woke" | "condition-passed";
    })[];
    readonly workUnitId: AutomationWorkUnitId | null;
    readonly at: Temporal.Instant;
  }
) =>
  moveAutomationRuns(tx, {
    workUnitId: input.workUnitId,
    moves: input.runs.map(
      (run): AutomationRunMove => ({
        position: run,
        stepId: run.nextStepId,
        phase: "ready",
        dueAt: input.at,
        stepEnteredAt: Option.some(input.at),
        entry: {
          runId: run.runId,
          kind: run.passed,
          stepId: run.stepId,
          at: input.at,
        },
      })
    ),
  });

/**
 * Puts unowned runs to wait at their step until `dueAt`, or moves a waiting
 * run's due time after a pause passed it over (D12), with a `waiting` entry.
 */
export const waitAutomationRuns = (
  tx: AutomationEngineTransaction,
  input: {
    readonly runs: readonly (AutomationRunPosition & {
      readonly dueAt: Temporal.Instant;
    })[];
    readonly at: Temporal.Instant;
  }
) =>
  moveAutomationRuns(tx, {
    workUnitId: null,
    moves: input.runs.map(
      (run): AutomationRunMove => ({
        position: run,
        stepId: run.stepId,
        phase: "waiting",
        dueAt: run.dueAt,
        stepEnteredAt: Option.none(),
        entry: {
          runId: run.runId,
          kind: "waiting",
          stepId: run.stepId,
          at: input.at,
          detail: { dueAt: temporalInstantToIsoString(run.dueAt) },
        },
      })
    ),
  });

/**
 * Wakes unowned waiting runs at their own step, `ready` and due at `at`,
 * with a `woke` entry: a send step's deferred trigger is verified again by
 * the next deliver unit (§5.9).
 */
export const wakeAutomationRuns = (
  tx: AutomationEngineTransaction,
  input: {
    readonly runs: readonly AutomationRunPosition[];
    readonly at: Temporal.Instant;
  }
) =>
  moveAutomationRuns(tx, {
    workUnitId: null,
    moves: input.runs.map(
      (run): AutomationRunMove => ({
        position: run,
        stepId: run.stepId,
        phase: "ready",
        dueAt: input.at,
        stepEnteredAt: Option.none(),
        entry: {
          runId: run.runId,
          kind: "woke",
          stepId: run.stepId,
          at: input.at,
        },
      })
    ),
  });
