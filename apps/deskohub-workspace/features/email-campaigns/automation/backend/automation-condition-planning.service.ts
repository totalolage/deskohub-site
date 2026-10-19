import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
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
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { AutomationRunTransitions } from "./automation-run-transitions";
import type {
  AutomationEngineTransaction,
  PlannedAutomationUnit,
} from "./automation-unit-handler";
import { planAutomationUnits } from "./automation-unit-planning";
import {
  automationRunStepKind,
  loadAutomationVersionFlows,
} from "./automation-version-flows";
import {
  type AutomationRunTrigger,
  automationRunEvaluationContext,
  conditionStepAt,
  plannedConditionUnit,
} from "./condition";

/** What planner step 6 did, for the plan summary. */
export type AutomationConditionPlan = {
  /** Runs given to a condition unit. */
  readonly runsPlanned: number;
  /** Condition units planned. */
  readonly unitsPlanned: number;
  /**
   * Runs ended `failed / evaluation-unavailable` instead: their flow or step
   * is gone, or a referenced saved audience was deleted.
   */
  readonly runsEnded: number;
};

/** The plan when nothing was due. */
export const emptyAutomationConditionPlan: AutomationConditionPlan = {
  runsPlanned: 0,
  unitsPlanned: 0,
  runsEnded: 0,
};

/** The most unplanned condition runs one planner run reads. */
const maxUnplannedRuns = 2_000;

/** An unplanned run at a Condition step, locked for planning. */
type ConditionRun = AutomationRunTrigger & {
  readonly runId: AutomationRunId;
  readonly versionId: AutomationVersionId;
  readonly stepId: AutomationStepId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

/** One `(version, step)`'s runs: planned into units, or ended. */
type StepPlan =
  | {
      readonly _tag: "Planned";
      readonly units: readonly {
        readonly unit: PlannedAutomationUnit;
        readonly runIds: readonly AutomationRunId[];
      }[];
    }
  | {
      readonly _tag: "Unavailable";
      readonly stepId: AutomationStepId;
      readonly runIds: readonly AutomationRunId[];
    };

interface IAutomationConditionPlanning {
  /**
   * Planner step 6 (§5.8): packs unplanned `ready` runs at Condition steps into condition units per `(version, step)`. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationConditionPlan, DatabaseQueryError>;
}

export class AutomationConditionPlanning extends Context.Service<
  AutomationConditionPlanning,
  IAutomationConditionPlanning
>()("@deskohub-workspace/email-campaigns/AutomationConditionPlanning") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;

      /**
       * Units of at most 50 customers whose Dotypos requests fit a unit
       * (§5.3), packed in run id order, for one step's runs. A deleted saved
       * audience can't pass again, so those runs end instead (§2.3).
       */
      const planStep = (input: {
        readonly campaignId: CampaignId;
        readonly runs: readonly [ConditionRun, ...ConditionRun[]];
        readonly flowOf: Effect.Success<
          ReturnType<typeof loadAutomationVersionFlows>
        >;
        readonly at: Temporal.Instant;
      }): Effect.Effect<StepPlan> => {
        const [first] = input.runs;
        const unavailable: StepPlan = {
          _tag: "Unavailable",
          stepId: first.stepId,
          runIds: input.runs.map((run) => run.runId),
        };
        const runOf = new Map(
          input.runs.map((run) => [run.dotyposCustomerId, run.runId])
        );
        return Option.match(
          conditionStepAt(input.flowOf(first.versionId), first.stepId),
          {
            onNone: () => Effect.succeed(unavailable),
            onSome: ({ filter }) =>
              facts
                .plan({
                  filters: { condition: filter },
                  context: automationRunEvaluationContext(first, {
                    campaignId: input.campaignId,
                    now: input.at,
                  }),
                })
                .pipe(
                  Effect.flatMap((plan) =>
                    facts.pack({
                      reads: plan.reads,
                      customers: input.runs.map((run) => run.dotyposCustomerId),
                    })
                  ),
                  Effect.flatMap((chunks) =>
                    Effect.forEach(chunks, (chunk) =>
                      Effect.sync(() => crypto.randomUUID()).pipe(
                        Effect.map((id) => {
                          const runIds = chunk.customers.flatMap((customer) =>
                            Option.toArray(
                              Option.fromUndefinedOr(runOf.get(customer))
                            )
                          );
                          return {
                            runIds,
                            unit: plannedConditionUnit({
                              id,
                              campaignId: input.campaignId,
                              versionId: first.versionId,
                              stepId: first.stepId,
                              runIds,
                              requestCost: chunk.requestCost,
                            }),
                          };
                        })
                      )
                    )
                  ),
                  Effect.map((units): StepPlan => ({ _tag: "Planned", units })),
                  Effect.catchTag("AutomationConditionAudienceMissing", () =>
                    Effect.succeed(unavailable)
                  )
                ),
          }
        );
      };

      /**
       * One automation's unplanned condition runs, under its lifecycle lock
       * (§5.4). Runs another planner holds are skipped, and each unit takes
       * its runs by compare-and-set in the same transaction.
       */
      const planAutomation = Effect.fn(
        "AutomationConditionPlanning.planAutomation"
      )(function* (
        tx: AutomationEngineTransaction,
        input: {
          readonly campaignId: CampaignId;
          readonly runIds: readonly AutomationRunId[];
          readonly at: Temporal.Instant;
        }
      ) {
        const lifecycle = yield* lockAutomationForEngine(tx, input.campaignId);
        if (lifecycle.status !== "active") return emptyAutomationConditionPlan;

        const locked = yield* tx
          .select({
            runId: runs.id,
            versionId: runs.versionId,
            stepId: runs.stepId,
            dotyposCustomerId: runs.dotyposCustomerId,
            triggerKind: runs.triggerKind,
            triggerAt: runs.triggerAt,
            triggerReservationId: runs.triggerReservationId,
          })
          .from(runs)
          .where(
            and(
              inArray(runs.id, [...input.runIds]),
              eq(runs.status, "active"),
              eq(runs.phase, "ready"),
              isNull(runs.workUnitId)
            )
          )
          .orderBy(runs.id)
          .for("update", { skipLocked: true });
        const flowOf = yield* loadAutomationVersionFlows(
          tx,
          locked.map((run) => run.versionId)
        );
        const stepPlans = yield* Effect.forEach(
          [
            ...Map.groupBy(
              locked,
              (run) => `${run.versionId}\u0000${run.stepId}`
            ).values(),
          ].flatMap((group) => {
            const [first, ...rest] = group;
            return first === undefined ? [] : [[first, ...rest] as const];
          }),
          (stepRuns) =>
            planStep({
              campaignId: input.campaignId,
              runs: stepRuns,
              flowOf,
              at: input.at,
            })
        );

        const ended = yield* Effect.forEach(stepPlans, (stepPlan) =>
          stepPlan._tag === "Unavailable"
            ? AutomationRunTransitions.end(tx, {
                runIds: stepPlan.runIds,
                expect: {
                  status: "active",
                  stepId: stepPlan.stepId,
                  phase: "ready",
                  workUnitId: null,
                },
                outcome: "failed",
                reason: "evaluation-unavailable",
                at: input.at,
              })
            : Effect.succeed([])
        );
        const planned = stepPlans.flatMap((stepPlan) =>
          stepPlan._tag === "Planned" ? stepPlan.units : []
        );
        const { written } = yield* planAutomationUnits(
          tx,
          planned.map(({ unit }) => unit),
          input.at
        );
        const runIdsOf = new Map(
          planned.map(({ unit, runIds }) => [unit.key, runIds])
        );
        const owned = yield* Effect.forEach(written, ({ unitId, key }) =>
          tx
            .update(runs)
            .set({ workUnitId: unitId, updatedAt: sql`now()` })
            .where(
              and(
                inArray(runs.id, [...(runIdsOf.get(key) ?? [])]),
                eq(runs.status, "active"),
                eq(runs.phase, "ready"),
                isNull(runs.workUnitId)
              )
            )
            .returning({ runId: runs.id })
        );
        return {
          runsPlanned: owned.flat().length,
          unitsPlanned: written.length,
          runsEnded: ended.flat().length,
        } satisfies AutomationConditionPlan;
      });

      return {
        plan: (at) =>
          Effect.Do.pipe(
            Effect.bind("unplanned", () =>
              db
                .select({ runId: runs.id, campaignId: runs.campaignId })
                .from(runs)
                .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
                .innerJoin(versions, eq(versions.id, runs.versionId))
                .where(
                  and(
                    eq(runs.status, "active"),
                    eq(runs.phase, "ready"),
                    isNull(runs.workUnitId),
                    eq(campaigns.status, "active"),
                    sql`${automationRunStepKind} = 'Condition'`
                  )
                )
                .orderBy(asc(runs.campaignId), asc(runs.id))
                .limit(maxUnplannedRuns)
            ),
            Effect.bind("plans", ({ unplanned }) =>
              Effect.forEach(
                Map.groupBy(unplanned, (run) => run.campaignId),
                ([campaignId, campaignRuns]) =>
                  db.transaction((tx) =>
                    planAutomation(tx, {
                      campaignId,
                      runIds: campaignRuns.map((run) => run.runId),
                      at,
                    })
                  )
              )
            ),
            Effect.map(({ plans }) =>
              plans.reduce(
                (total, plan): AutomationConditionPlan => ({
                  runsPlanned: total.runsPlanned + plan.runsPlanned,
                  unitsPlanned: total.unitsPlanned + plan.unitsPlanned,
                  runsEnded: total.runsEnded + plan.runsEnded,
                }),
                emptyAutomationConditionPlan
              )
            ),
            Effect.withSpan("AutomationConditionPlanning.plan")
          ),
      } satisfies IAutomationConditionPlanning;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, AutomationEvaluationFacts.Live)
    )
  );
}
