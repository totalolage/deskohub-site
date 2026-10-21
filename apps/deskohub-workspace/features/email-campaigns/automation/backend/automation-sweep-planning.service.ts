import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { ReservationActivitySweep } from "@/features/reservation/backend/reservation-activity-sweep.service";
import { CustomerEventReconciler } from "@/shared/backend/customer-events/customer-event-reconciler";
import { planAutomationUnits } from "./automation-unit-planning";
import { plannedSweepPage } from "./sweep-page";

/** What planner step 3 did, for the plan summary. */
type AutomationSweepPlan = {
  readonly sweepPagesPlanned: number;
  /** Failed sweep pages whose backoff passed, planned again. */
  readonly sweepPagesReplanned: number;
  readonly eventsReconciled: number;
};

interface IAutomationSweepPlanning {
  /**
   * Planner step 3: plans a sweep page for each source with none open
   * (`planAutomationUnits`), replanning a failed page after its backoff,
   * and reconciles captured events. Runs its own short idempotent
   * transactions, so overlapping planners are harmless.
   */
  readonly plan: (
    at: Temporal.Instant
  ) => Effect.Effect<AutomationSweepPlan, DatabaseQueryError>;
}

export class AutomationSweepPlanning extends Context.Service<
  AutomationSweepPlanning,
  IAutomationSweepPlanning
>()("@deskohub-workspace/email-campaigns/AutomationSweepPlanning") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const sweep = yield* ReservationActivitySweep;
      const reconciler = yield* CustomerEventReconciler;

      return {
        plan: (at) =>
          Effect.Do.pipe(
            Effect.bind("pages", () =>
              db.transaction((tx) =>
                sweep
                  .duePages(tx, at)
                  .pipe(
                    Effect.flatMap((pages) =>
                      planAutomationUnits(tx, pages.map(plannedSweepPage), at)
                    )
                  )
              )
            ),
            Effect.bind("eventsReconciled", () =>
              reconciler.reconcile.pipe(
                Effect.map(
                  ({ booked, cancelled, accountCreated }) =>
                    booked + cancelled + accountCreated
                )
              )
            ),
            Effect.map(
              ({ pages, eventsReconciled }): AutomationSweepPlan => ({
                sweepPagesPlanned: pages.planned,
                sweepPagesReplanned: pages.replanned.length,
                eventsReconciled,
              })
            ),
            Effect.withSpan("AutomationSweepPlanning.plan")
          ),
      } satisfies IAutomationSweepPlanning;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        ReservationActivitySweep.Default,
        CustomerEventReconciler.Live
      )
    )
  );
}
