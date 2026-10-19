import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { ReservationActivitySweep } from "@/features/reservation/backend/reservation-activity-sweep.service";
import { CustomerEventReconciler } from "@/shared/backend/customer-events/customer-event-reconciler";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { planAutomationUnits } from "./automation-unit-planning";
import { plannedSweepPage } from "./sweep-page";

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
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const sweep = yield* ReservationActivitySweep;
      const reconciler = yield* CustomerEventReconciler;

      return {
        plan: Effect.fn("AutomationSweepPlanning.plan")(function* (
          at: Temporal.Instant
        ) {
          const sweepPagesPlanned = yield* db.transaction((tx) =>
            sweep
              .duePages(tx, at)
              .pipe(
                Effect.flatMap((pages) =>
                  planAutomationUnits(tx, pages.map(plannedSweepPage))
                )
              )
          );
          const eventsReconciled = isReconcileMinute(at)
            ? yield* reconciler.reconcile.pipe(
                Effect.map(
                  ({ booked, cancelled, accountCreated }) =>
                    booked + cancelled + accountCreated
                )
              )
            : 0;
          return { sweepPagesPlanned, eventsReconciled };
        }),
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

/**
 * The capture reconcile runs on planner runs whose Workspace-local minute is
 * a multiple of ten. The minute cron hits each such minute once; overlapping
 * or repeated runs in that minute are harmless because the reconcile is
 * idempotent, and a skipped minute only delays it to the next tenth.
 */
const isReconcileMinute = (at: Temporal.Instant) =>
  at.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone).minute %
    10 ===
  0;
