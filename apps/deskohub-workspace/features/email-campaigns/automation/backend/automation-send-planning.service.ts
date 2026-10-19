import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 7 did, for the plan summary. */
export type AutomationSendPlan = {
  /** Runs given to a deliver unit. */
  readonly runsPlanned: number;
  /** Deliver units planned. */
  readonly unitsPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationSendPlan: AutomationSendPlan = {
  runsPlanned: 0,
  unitsPlanned: 0,
};

interface IAutomationSendPlanning {
  /**
   * Planner step 7 (§5.9): packs unplanned `ready` runs at Send steps into deliver units of at most 100 runs per version. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationSendPlan, DatabaseQueryError>;
}

export class AutomationSendPlanning extends Context.Service<
  AutomationSendPlanning,
  IAutomationSendPlanning
>()("@deskohub-workspace/email-campaigns/AutomationSendPlanning") {
  static Default = Layer.succeed(this, {
    plan: () => Effect.succeed(emptyAutomationSendPlan),
  });

  static Live = this.Default;
}
