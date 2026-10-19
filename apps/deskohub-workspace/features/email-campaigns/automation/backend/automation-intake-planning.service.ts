import { Context, Effect, Layer } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";

/** What planner step 4 did, for the plan summary. */
export type AutomationIntakePlan = {
  /** Runs ended `withdrawn` by eager withdrawal (D28). */
  readonly withdrawnRuns: number;
  /** Events packed into intake units. */
  readonly eventsMatched: number;
  /** Events matching no automation, marked processed. */
  readonly eventsProcessed: number;
  /** Intake units planned. */
  readonly unitsPlanned: number;
};

/** The plan when nothing was due. */
export const emptyAutomationIntakePlan: AutomationIntakePlan = {
  withdrawnRuns: 0,
  eventsMatched: 0,
  eventsProcessed: 0,
  unitsPlanned: 0,
};

interface IAutomationIntakePlanning {
  /**
   * Planner step 4 (§5.6): withdraws the active runs of each unprocessed `reservation-cancelled` event's reservation, matches up to 2,000 unplanned events against active automations, marks events matching nothing processed, and packs the rest by customer into intake units. Runs its own short idempotent transactions, so overlapping
   * planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationIntakePlan, DatabaseQueryError>;
}

export class AutomationIntakePlanning extends Context.Service<
  AutomationIntakePlanning,
  IAutomationIntakePlanning
>()("@deskohub-workspace/email-campaigns/AutomationIntakePlanning") {
  static Default = Layer.succeed(this, {
    plan: () => Effect.succeed(emptyAutomationIntakePlan),
  });

  static Live = this.Default;
}
