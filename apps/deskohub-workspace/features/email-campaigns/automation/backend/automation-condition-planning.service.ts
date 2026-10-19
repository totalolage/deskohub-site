import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 6 did, for the plan summary. */
export type AutomationConditionPlan = {
  /** Runs given to a condition unit. */
  readonly runsPlanned: number;
  /** Condition units planned. */
  readonly unitsPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationConditionPlan: AutomationConditionPlan = {
  runsPlanned: 0,
  unitsPlanned: 0,
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
  static Default = Layer.succeed(this, {
    plan: () => Effect.succeed(emptyAutomationConditionPlan),
  });

  static Live = this.Default;
}
