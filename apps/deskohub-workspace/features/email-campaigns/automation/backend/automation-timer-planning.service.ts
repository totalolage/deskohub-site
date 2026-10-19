import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 5 did, for the plan summary. */
export type AutomationTimerPlan = {
  /** Due runs read. */
  readonly due: number;
  /** Runs moved to their next step. */
  readonly advanced: number;
  /** Runs that entered or re-entered a wait. */
  readonly waiting: number;
  /** Runs ended by a timer. */
  readonly ended: number;
};

/** The plan when nothing was due. */
export const emptyAutomationTimerPlan: AutomationTimerPlan = {
  due: 0,
  advanced: 0,
  waiting: 0,
  ended: 0,
};

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
  static Default = Layer.succeed(this, {
    plan: () => Effect.succeed(emptyAutomationTimerPlan),
  });

  static Live = this.Default;
}
