import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AutomationConditionFilter } from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { AudienceEvaluationContext } from "../../backend/audience-evaluation-context";
import type { CampaignId } from "../../campaign-identifiers";
import type {
  AutomationRunId,
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";
import type { AutomationTriggerKind } from "../automation-states";
import type { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { AutomationRunTransitions } from "./automation-run-transitions";
import { planAutomationRunUnits } from "./automation-run-units";
import type { PlannedAutomationUnit } from "./automation-unit-handler";
import {
  type AutomationStepPosition,
  automationStepPosition,
} from "./automation-version-flows";

export const conditionSubjectSchema = Schema.Struct({
  versionId: Schema.NonEmptyString.pipe(Schema.brand("AutomationVersionId")),
  stepId: Schema.NonEmptyString.pipe(Schema.brand("AutomationStepId")),
  runIds: Schema.Array(
    Schema.NonEmptyString.pipe(Schema.brand("AutomationRunId"))
  ),
  /**
   * The unit's depth in its chain (D36): 0 for a unit entry or the planner
   * planned, one more than the condition unit that planned it. Units queued
   * before chaining existed have none and count as 0.
   */
  chainedSteps: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
  ),
});
export type ConditionSubject = typeof conditionSubjectSchema.Type;

/**
 * A `condition` unit for runs at one `(version, step)`. `id` keeps the key
 * unique per planning, so runs a settled unit released are planned again.
 */
const plannedConditionUnit = (input: {
  readonly id: string;
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  readonly stepId: AutomationStepId;
  readonly runIds: readonly AutomationRunId[];
  readonly requestCost: number;
  readonly chainedSteps: number;
}): PlannedAutomationUnit => ({
  kind: "condition",
  key: `condition:${input.versionId}:${input.stepId}:${input.id}`,
  campaignId: input.campaignId,
  subject: Schema.encodeSync(conditionSubjectSchema)({
    versionId: input.versionId,
    stepId: input.stepId,
    runIds: [...input.runIds],
    chainedSteps: input.chainedSteps,
  }),
  requestCost: input.requestCost,
});

/** The filter of `stepId` if it is a Condition step of the flow. */
export const conditionStepAt = (
  ...position: Parameters<typeof automationStepPosition>
): Option.Option<
  AutomationStepPosition & {
    readonly filter: AutomationConditionFilter;
  }
> =>
  Option.flatMap(automationStepPosition(...position), ({ step, next }) =>
    step._tag === "Condition"
      ? Option.some({ step, next, filter: step.filter })
      : Option.none()
  );

/** What started a run, as its condition evaluates it. */
export type AutomationRunTrigger = {
  readonly triggerKind: AutomationTriggerKind;
  readonly triggerAt: Temporal.Instant;
  readonly triggerReservationId: WorkspaceReservationId | null;
};

/**
 * A run's condition context at `now`: its automation, which `This`
 * campaign sources name, and its trigger, which trigger-relative periods
 * count from.
 */
export const automationRunEvaluationContext = (
  run: AutomationRunTrigger,
  input: { readonly campaignId: CampaignId; readonly now: Temporal.Instant }
): AudienceEvaluationContext => ({
  now: input.now,
  campaignId: Option.some(input.campaignId),
  trigger: Option.some({
    kind: run.triggerKind,
    at: run.triggerAt,
    reservationId: Option.fromNullishOr(run.triggerReservationId),
  }),
});

/** A `ready`, unowned run at a Condition step, row-locked by the caller. */
export type ConditionStepRun = AutomationRunTrigger & {
  readonly runId: AutomationRunId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

/** One `(version, step)`'s runs, with the step's filter if it is still a Condition. */
export type ConditionStepRuns = {
  readonly versionId: AutomationVersionId;
  readonly stepId: AutomationStepId;
  readonly filter: Option.Option<AutomationConditionFilter>;
  readonly runs: readonly [ConditionStepRun, ...ConditionStepRun[]];
};

/** What planning condition steps did. */
export type ConditionStepsPlan = {
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

/** The plan of one step: its units, or `Unavailable` when its runs can't be decided. */
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

/**
 * Units of at most 50 customers whose Dotypos requests fit a unit (§5.3),
 * packed in run id order, for one step's runs. A deleted saved audience
 * can't pass again, so those runs end instead (§2.3).
 */
const planStep = (
  facts: AutomationEvaluationFacts["Service"],
  input: ConditionStepRuns & {
    readonly campaignId: CampaignId;
    readonly at: Temporal.Instant;
    readonly chainedSteps: number;
  }
): Effect.Effect<StepPlan> => {
  const [first] = input.runs;
  const unavailable: StepPlan = {
    _tag: "Unavailable",
    stepId: input.stepId,
    runIds: input.runs.map((run) => run.runId),
  };
  const runOf = new Map(
    input.runs.map((run) => [run.dotyposCustomerId, run.runId])
  );
  return Option.match(input.filter, {
    onNone: () => Effect.succeed(unavailable),
    onSome: (filter) =>
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
                    Option.toArray(Option.fromUndefinedOr(runOf.get(customer)))
                  );
                  return {
                    runIds,
                    unit: plannedConditionUnit({
                      id,
                      campaignId: input.campaignId,
                      versionId: input.versionId,
                      stepId: input.stepId,
                      runIds,
                      requestCost: chunk.requestCost,
                      chainedSteps: input.chainedSteps,
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
  });
};

/**
 * Packs one automation's `ready`, unowned runs at Condition steps into
 * condition units per `(version, step)`, and each unit takes its runs by
 * compare-and-set. Runs whose step can't be decided end `failed /
 * evaluation-unavailable`. The caller holds the automation's lifecycle lock
 * and the runs' row locks (§5.4): the planner after its locking read, a
 * condition unit's commit for the runs it just passed.
 */
export const planConditionSteps = Effect.fn("automationConditionSteps.plan")(
  function* (
    facts: AutomationEvaluationFacts["Service"],
    input: {
      readonly campaignId: CampaignId;
      readonly steps: readonly ConditionStepRuns[];
      readonly at: Temporal.Instant;
      readonly chainedSteps: number;
    }
  ) {
    const stepPlans = yield* Effect.forEach(input.steps, (step) =>
      planStep(facts, {
        ...step,
        campaignId: input.campaignId,
        at: input.at,
        chainedSteps: input.chainedSteps,
      })
    );
    const ended = yield* Effect.forEach(stepPlans, (stepPlan) =>
      stepPlan._tag === "Unavailable"
        ? AutomationRunTransitions.end({
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
    const owned = yield* planAutomationRunUnits(
      stepPlans.flatMap((stepPlan) =>
        stepPlan._tag === "Planned" ? stepPlan.units : []
      ),
      input.at
    );
    return {
      runsPlanned: owned.flat().length,
      unitsPlanned: owned.length,
      runsEnded: ended.flat().length,
    } satisfies ConditionStepsPlan;
  }
);
