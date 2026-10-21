import { and, asc, eq, lte, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Match, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaigns as campaigns,
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationVersions as versions,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import type { AutomationRunPhase } from "../automation-states";
import { evaluateStep } from "../automation-step-evaluation";
import { automationTickAtOrBefore } from "../automation-ticks";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { enterReachedWaits } from "./automation-reached-step";
import {
  type AutomationRunPosition,
  advanceAutomationRuns,
  waitAutomationRuns,
  wakeAutomationRuns,
} from "./automation-run-progress";
import { AutomationRunTransitions } from "./automation-run-transitions";
import type { AutomationEngineTransaction } from "./automation-unit-handler";
import {
  automationRunStepKind,
  automationStepPosition,
  loadAutomationVersionFlows,
} from "./automation-version-flows";

/** What planner step 5 did, for the plan summary. */
export type AutomationTimerPlan = {
  /** Due runs read. */
  readonly due: number;
  /** Runs moved to their next step. */
  readonly advanced: number;
  /** Runs that entered or re-entered a wait. */
  readonly waiting: number;
  /** Deferred send-step runs woken back to `ready` (§5.9). */
  readonly woken: number;
  /** Runs ended by a timer. */
  readonly ended: number;
};

/** The plan when nothing was due. */
export const emptyAutomationTimerPlan: AutomationTimerPlan = {
  due: 0,
  advanced: 0,
  waiting: 0,
  woken: 0,
  ended: 0,
};

/** The most due runs one planner run moves (§5.5). */
const maxDueRuns = 5_000;

/** A due run as planning read it. */
type DueRun = AutomationRunPosition & {
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  readonly stepEnteredAt: Temporal.Instant;
  readonly dueAt: Temporal.Instant;
};

/** What a timer does with one due run. */
type TimerMove =
  | {
      readonly _tag: "Wait";
      readonly run: DueRun;
      readonly dueAt: Temporal.Instant;
    }
  | {
      readonly _tag: "Advance";
      readonly run: DueRun;
      readonly nextStepId: AutomationStepId;
    }
  | { readonly _tag: "Wake"; readonly run: DueRun }
  | { readonly _tag: "End"; readonly run: DueRun }
  | { readonly _tag: "Skip"; readonly run: DueRun };

interface IAutomationTimerPlanning {
  /**
   * Planner step 5 (§5.8): moves up to 5,000 due `active` runs of active automations through `evaluateStep`: waits are entered or woken, and runs reaching a Condition or Send step become `ready`. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationTimerPlan, DatabaseQueryError>;
}

export class AutomationTimerPlanning extends Context.Service<
  AutomationTimerPlanning,
  IAutomationTimerPlanning
>()("@deskohub-workspace/email-campaigns/AutomationTimerPlanning") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      return {
        plan: (at) =>
          Effect.Do.pipe(
            Effect.bind("due", () => readDueRuns(db, at)),
            Effect.bind("plans", ({ due }) =>
              Effect.forEach(groupByCampaign(due), (automationRuns) =>
                db.transaction((tx) => moveDueRuns(tx, automationRuns, at))
              )
            ),
            Effect.map(({ due, plans }) =>
              plans.reduce(
                (total, plan): AutomationTimerPlan => ({
                  due: total.due,
                  advanced: total.advanced + plan.advanced,
                  waiting: total.waiting + plan.waiting,
                  woken: total.woken + plan.woken,
                  ended: total.ended + plan.ended,
                }),
                { ...emptyAutomationTimerPlan, due: due.length }
              )
            ),
            Effect.withSpan("AutomationTimerPlanning.plan")
          ),
      } satisfies IAutomationTimerPlanning;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/**
 * Due active runs of active automations, oldest due first, except `ready`
 * runs at a Condition or Send step: condition and send planning own those.
 * A run counts when due by the tick `at` falls in, as in `evaluateStep`.
 */
const readDueRuns = (
  db: WorkspaceDatabase["Service"]["db"],
  at: Temporal.Instant
) =>
  db
    .select({
      runId: runs.id,
      campaignId: runs.campaignId,
      versionId: runs.versionId,
      stepId: runs.stepId,
      phase: runs.phase,
      stepEnteredAt: runs.stepEnteredAt,
      dueAt: runs.dueAt,
    })
    .from(runs)
    .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
    .innerJoin(versions, eq(versions.id, runs.versionId))
    .where(
      and(
        eq(runs.status, "active"),
        lte(runs.dueAt, automationTickAtOrBefore(at)),
        sql`${runs.workUnitId} is null`,
        eq(campaigns.status, "active"),
        or(
          eq(runs.phase, "waiting"),
          sql`${automationRunStepKind} is distinct from 'Condition' and ${automationRunStepKind} is distinct from 'Send'`
        )
      )
    )
    .orderBy(asc(runs.dueAt), asc(runs.id))
    .limit(maxDueRuns)
    .pipe(
      Effect.map((rows) =>
        rows.flatMap((row): DueRun[] =>
          // An active run always has a phase and a due time (status check).
          row.phase === null || row.dueAt === null
            ? []
            : [{ ...row, phase: row.phase, dueAt: row.dueAt }]
        )
      )
    );

const groupByCampaign = (due: readonly DueRun[]) => [
  ...Map.groupBy(due, (run) => run.campaignId).values(),
];

/**
 * One automation's due runs, under its lifecycle lock (§5.4): a paused or
 * archived automation writes nothing, so its runs stay frozen. A woken
 * Calendar wait reads `resumed_at` under the lock (D12).
 */
const moveDueRuns = Effect.fn("AutomationTimerPlanning.moveDueRuns")(function* (
  tx: AutomationEngineTransaction,
  due: readonly DueRun[],
  at: Temporal.Instant
) {
  const [first] = due;
  if (first === undefined) return emptyAutomationTimerPlan;
  const lifecycle = yield* lockAutomationForEngine(tx, first.campaignId);
  if (lifecycle.status !== "active") return emptyAutomationTimerPlan;

  const flowOf = yield* loadAutomationVersionFlows(
    tx,
    due.map((run) => run.versionId)
  );
  const moves = due.map((run) =>
    timerMove(run, {
      at,
      flow: flowOf(run.versionId),
      resumedAt: Option.fromNullishOr(lifecycle.resumedAt),
    })
  );

  const waiting = yield* waitAutomationRuns(tx, {
    runs: moves.flatMap((move) =>
      move._tag === "Wait" ? [{ ...move.run, dueAt: move.dueAt }] : []
    ),
    at,
  });
  const advanced = yield* advanceAutomationRuns(tx, {
    runs: moves.flatMap((move) =>
      move._tag === "Advance"
        ? [
            {
              ...move.run,
              nextStepId: move.nextStepId,
              passed: "woke" as const,
            },
          ]
        : []
    ),
    workUnitId: null,
    at,
  });
  // A wait the advanced runs reach is entered now, as a unit would (D36);
  // Conditions and the Send stay `ready` for this tick's later steps.
  const movedOn = new Set(advanced);
  yield* Effect.forEach(
    Map.groupBy(
      moves.flatMap((move) =>
        move._tag === "Advance" && movedOn.has(move.run.runId) ? [move] : []
      ),
      (move) => `${move.run.versionId}\u0000${move.nextStepId}`
    ).values(),
    (group) => {
      const [first] = group;
      return first === undefined
        ? Effect.void
        : enterReachedWaits(tx, {
            campaignId: first.run.campaignId,
            versionId: first.run.versionId,
            flow: flowOf(first.run.versionId),
            stepId: first.nextStepId,
            runs: group.map((move) => ({ runId: move.run.runId })),
            at,
            chainedSteps: 1,
          });
    },
    { discard: true }
  );
  const woken = yield* wakeAutomationRuns(tx, {
    runs: moves.flatMap((move) => (move._tag === "Wake" ? [move.run] : [])),
    at,
  });
  const ended = yield* endUnavailable(
    tx,
    moves.flatMap((move) => (move._tag === "End" ? [move.run] : [])),
    at
  );
  return {
    due: due.length,
    advanced: advanced.length,
    waiting: waiting.length,
    woken: woken.length,
    ended,
  } satisfies AutomationTimerPlan;
});

/**
 * The timer's move for one due run. A run whose flow or step is gone, or a
 * calendar that never occurs again, ends; a waiting run at a step that
 * isn't a wait (a deferred send) goes back to `ready` there.
 */
const timerMove = (
  run: DueRun,
  input: {
    readonly at: Temporal.Instant;
    readonly flow: Parameters<typeof automationStepPosition>[0];
    readonly resumedAt: Option.Option<Temporal.Instant>;
  }
): TimerMove =>
  Option.match(automationStepPosition(input.flow, run.stepId), {
    onNone: (): TimerMove => ({ _tag: "End", run }),
    onSome: ({ step, next }) =>
      Match.value(
        evaluateStep({
          step,
          phase: run.phase,
          at: input.at,
          stepEnteredAt: run.stepEnteredAt,
          dueAt: Option.some(run.dueAt),
          resumedAt: input.resumedAt,
          condition: Option.none(),
        })
      ).pipe(
        Match.tagsExhaustive({
          Wait: ({ dueAt }): TimerMove => ({ _tag: "Wait", run, dueAt }),
          Advance: (): TimerMove =>
            Option.match(next, {
              onNone: (): TimerMove => ({ _tag: "End", run }),
              onSome: ({ id }): TimerMove => ({
                _tag: "Advance",
                run,
                nextStepId: id,
              }),
            }),
          End: (): TimerMove => ({ _tag: "End", run }),
          Send: (): TimerMove => wakeWaiting(run),
          EvaluateCondition: (): TimerMove => wakeWaiting(run),
        })
      ),
  });

/** A `ready` run at a send or condition step belongs to its unit's planner. */
const wakeWaiting = (run: DueRun): TimerMove =>
  run.phase === "waiting" ? { _tag: "Wake", run } : { _tag: "Skip", run };

/**
 * Ends runs that can't move `failed / evaluation-unavailable`, one
 * compare-and-set per position they were read at.
 */
const endUnavailable = (
  tx: AutomationEngineTransaction,
  ending: readonly DueRun[],
  at: Temporal.Instant
) => {
  const positions = new Map<
    string,
    {
      readonly stepId: AutomationStepId;
      readonly phase: AutomationRunPhase;
      readonly runIds: AutomationRunId[];
    }
  >();
  for (const run of ending) {
    const key = `${run.stepId}\u0000${run.phase}`;
    const position = positions.get(key) ?? {
      stepId: run.stepId,
      phase: run.phase,
      runIds: [],
    };
    position.runIds.push(run.runId);
    positions.set(key, position);
  }
  return Effect.forEach(positions.values(), ({ stepId, phase, runIds }) =>
    AutomationRunTransitions.end(tx, {
      runIds,
      expect: { status: "active", stepId, phase, workUnitId: null },
      outcome: "failed",
      reason: "evaluation-unavailable",
      at,
    })
  ).pipe(Effect.map((ended) => ended.flat().length));
};
