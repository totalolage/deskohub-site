import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 8 did, for the plan summary. */
export type AutomationSchedulePlan = {
  /** Fires created with their chunk units. */
  readonly firesCreated: number;
  /** Fires with an empty pool, entered at once. */
  readonly firesEntered: number;
  /** Fire-chunk units planned. */
  readonly chunksPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationSchedulePlan: AutomationSchedulePlan = {
  firesCreated: 0,
  firesEntered: 0,
  chunksPlanned: 0,
};

interface IAutomationSchedulePlanning {
  /**
   * Planner step 8 (§5.7): runs `planNextFire` for each due schedule automation without an `entering` fire. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationSchedulePlan, DatabaseQueryError>;
}

export class AutomationSchedulePlanning extends Context.Service<
  AutomationSchedulePlanning,
  IAutomationSchedulePlanning
>()("@deskohub-workspace/email-campaigns/AutomationSchedulePlanning") {
  static Default = Layer.succeed(this, {
    plan: () => Effect.succeed(emptyAutomationSchedulePlan),
  });

  static Live = this.Default;
}
