import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 3 did, for the plan summary. */
export type AutomationSweepPlan = {
  readonly sweepPagesPlanned: number;
  readonly eventsReconciled: number;
};

interface IAutomationSweepPlanning {
  /**
   * Planner step 3: plans a sweep page for each source with none open
   * (`planAutomationUnits`) and, every 10th minute, reconciles captured
   * events. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationSweepPlan, DatabaseQueryError>;
}

export class AutomationSweepPlanning extends Context.Service<
  AutomationSweepPlanning,
  IAutomationSweepPlanning
>()("@deskohub-workspace/email-campaigns/AutomationSweepPlanning") {
  static Live = Layer.succeed(this, {
    plan: () => Effect.succeed({ sweepPagesPlanned: 0, eventsReconciled: 0 }),
  });
}
