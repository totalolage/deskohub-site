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
import type { AutomationRunId } from "../automation-identifiers";
import {
  type ConditionStepRuns,
  type ConditionStepsPlan,
  conditionStepAt,
  planConditionSteps,
} from "./automation-condition-units";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import {
  automationRunStepKind,
  loadAutomationVersionFlows,
} from "./automation-version-flows";

/** What planner step 6 did, for the plan summary. */
export type AutomationConditionPlan = ConditionStepsPlan;

/** The plan when nothing was due. */
export const emptyAutomationConditionPlan: AutomationConditionPlan = {
  runsPlanned: 0,
  unitsPlanned: 0,
  runsEnded: 0,
};

/** The most unplanned condition runs one planner run reads. */
const maxUnplannedRuns = 2_000;

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
      const { db, transaction } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;

      /**
       * One automation's unplanned condition runs, under its lifecycle lock
       * (§5.4). Runs another planner holds are skipped, and each unit takes
       * its runs by compare-and-set in the same transaction.
       */
      const planAutomation = Effect.fn(
        "AutomationConditionPlanning.planAutomation"
      )(function* (input: {
        readonly campaignId: CampaignId;
        readonly runIds: readonly AutomationRunId[];
        readonly at: Temporal.Instant;
      }) {
        const lifecycle = yield* lockAutomationForEngine(input.campaignId);
        if (lifecycle.status !== "active") return emptyAutomationConditionPlan;

        const locked = yield* db
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
          db,
          locked.map((run) => run.versionId)
        );
        return yield* planConditionSteps(facts, {
          campaignId: input.campaignId,
          steps: [
            ...Map.groupBy(
              locked,
              (run) => `${run.versionId}\u0000${run.stepId}`
            ).values(),
          ].flatMap((group): ConditionStepRuns[] => {
            const [first, ...rest] = group;
            return first === undefined
              ? []
              : [
                  {
                    versionId: first.versionId,
                    stepId: first.stepId,
                    filter: Option.map(
                      conditionStepAt(flowOf(first.versionId), first.stepId),
                      ({ filter }) => filter
                    ),
                    runs: [first, ...rest],
                  },
                ];
          }),
          at: input.at,
          // The planner starts every chain (D36).
          chainedSteps: 0,
        });
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
                  transaction(
                    planAutomation({
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
