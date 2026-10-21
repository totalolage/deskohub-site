import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  customerEvents,
  emailCampaignAutomationEngine,
  emailCampaignAutomationPreviews,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type AutomationConditionPlan,
  AutomationConditionPlanning,
} from "./automation-condition-planning.service";
import {
  type AutomationIntakePlan,
  AutomationIntakePlanning,
} from "./automation-intake-planning.service";
import {
  type AutomationSchedulePlan,
  AutomationSchedulePlanning,
} from "./automation-schedule-planning.service";
import {
  type AutomationSendPlan,
  AutomationSendPlanning,
} from "./automation-send-planning.service";
import { AutomationSweepPlanning } from "./automation-sweep-planning.service";
import {
  type AutomationTimerPlan,
  AutomationTimerPlanning,
} from "./automation-timer-planning.service";
import { AutomationUnitHandlers } from "./automation-unit-handlers.service";
import { releaseAutomationUnitSubjects } from "./automation-unit-planning";
import { AutomationUnitQueue } from "./automation-unit-queue.service";
import { AutomationUnitSlots } from "./automation-unit-slots";

/** What one planner run did; stored as `last_plan_summary` and logged once. */
type AutomationPlanSummary = {
  readonly plannedAt: string;
  readonly reaped: {
    /** Expired claims returned to `enqueued` and re-sent. */
    readonly requeued: number;
    /** `enqueued` units unclaimed for 10 minutes, re-sent. */
    readonly resent: number;
    /** Marked units settled `dropped`. */
    readonly dropped: number;
  };
  readonly sweepPagesPlanned: number;
  /** Failed sweep pages planned again after their backoff. */
  readonly sweepPagesReplanned: number;
  readonly eventsReconciled: number;
  readonly intake: AutomationIntakePlan;
  readonly timers: AutomationTimerPlan;
  readonly conditions: AutomationConditionPlan;
  readonly sends: AutomationSendPlan;
  readonly schedules: AutomationSchedulePlan;
  readonly pruned: {
    readonly units: number;
    readonly previews: number;
    readonly events: number;
  };
  readonly promoted: number;
  readonly inFlightByKind: Readonly<Record<string, number>>;
  /** Units not yet done or dropped that have failed at least once. */
  readonly failingByKind: Readonly<Record<string, number>>;
};

interface IAutomationPlanner {
  /**
   * One cron tick's planning. Every step is its own short idempotent
   * transaction, so overlapping runs are harmless and need no lease.
   */
  readonly plan: Effect.Effect<AutomationPlanSummary, DatabaseQueryError>;
}

/** A message lost or expired before any claim is re-sent after this long. */
const unclaimedResendAfter = { minutes: 10 } as const;
const settledUnitRetention = { hours: 7 * 24 } as const;
const previewRetention = { hours: 24 } as const;
const customerEventRetention = { hours: 90 * 24 } as const;
/** Rows deleted per table per run, so housekeeping stays a short transaction. */
const housekeepingBatchSize = 1000;

export class AutomationPlanner extends Context.Service<
  AutomationPlanner,
  IAutomationPlanner
>()("@deskohub-workspace/email-campaigns/AutomationPlanner") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const { supportedKinds } = yield* AutomationUnitHandlers;
      const sweepPlanning = yield* AutomationSweepPlanning;
      const intakePlanning = yield* AutomationIntakePlanning;
      const timerPlanning = yield* AutomationTimerPlanning;
      const conditionPlanning = yield* AutomationConditionPlanning;
      const sendPlanning = yield* AutomationSendPlanning;
      const schedulePlanning = yield* AutomationSchedulePlanning;
      const slots = yield* AutomationUnitSlots;

      const heartbeat = (at: Temporal.Instant) =>
        db
          .update(emailCampaignAutomationEngine)
          .set({ lastPlannedAt: at })
          .where(eq(emailCampaignAutomationEngine.id, 1))
          .pipe(Effect.withSpan("automationPlanner.heartbeat"));

      /** Marked units no live claimant holds. */
      /**
       * A unit with `send_id` owns a persisted batch, its only recovery path
       * (§5.9), so a mark never drops it: the reaper requeues it instead.
       */
      const recoverable = or(
        isNull(units.cancelRequestedAt),
        isNotNull(units.sendId)
      );

      const droppable = (at: Temporal.Instant) =>
        and(
          inArray(units.kind, supportedKinds),
          isNotNull(units.cancelRequestedAt),
          isNull(units.sendId),
          or(
            eq(units.status, "enqueued"),
            and(eq(units.status, "claimed"), lte(units.claimExpiresAt, at))
          )
        );

      /**
       * Recovers units whose consumer died or whose message was lost. Only
       * supported kinds, and never by campaign status, so a persisted
       * deliver unit recovers while its automation is paused or archived.
       */
      const reap = (at: Temporal.Instant) =>
        db
          .transaction((tx) =>
            Effect.all({
              // Marked units only ever settle `dropped`, so their subjects
              // are freed first, in lock order, before the unit rows.
              dropped: tx
                .select({ id: units.id, subject: units.subject })
                .from(units)
                .where(droppable(at))
                .pipe(
                  Effect.tap((marked) =>
                    releaseAutomationUnitSubjects(tx, marked)
                  ),
                  Effect.flatMap((marked) =>
                    tx
                      .update(units)
                      .set({
                        status: "dropped",
                        claimId: null,
                        claimExpiresAt: null,
                        settledAt: at,
                      })
                      .where(
                        and(
                          inArray(
                            units.id,
                            marked.map((unit) => unit.id)
                          ),
                          droppable(at)
                        )
                      )
                      .returning({ unitId: units.id })
                  )
                ),
              requeued: tx
                .update(units)
                .set({
                  status: "enqueued",
                  claimId: null,
                  claimExpiresAt: null,
                  enqueuedAt: at,
                  lastErrorCode: "claim-expired",
                  enqueueGeneration: sql`${units.enqueueGeneration} + 1`,
                })
                .where(
                  and(
                    inArray(units.kind, supportedKinds),
                    recoverable,
                    eq(units.status, "claimed"),
                    lte(units.claimExpiresAt, at)
                  )
                )
                .returning({
                  unitId: units.id,
                  enqueueGeneration: units.enqueueGeneration,
                }),
              resent: tx
                .update(units)
                .set({
                  enqueuedAt: at,
                  enqueueGeneration: sql`${units.enqueueGeneration} + 1`,
                })
                .where(
                  and(
                    inArray(units.kind, supportedKinds),
                    recoverable,
                    eq(units.status, "enqueued"),
                    lt(units.enqueuedAt, at.subtract(unclaimedResendAfter))
                  )
                )
                .returning({
                  unitId: units.id,
                  enqueueGeneration: units.enqueueGeneration,
                }),
            })
          )
          .pipe(
            Effect.tap(({ requeued, resent }) =>
              slots.publish([...requeued, ...resent])
            ),
            Effect.map(({ dropped, requeued, resent }) => ({
              dropped: dropped.length,
              requeued: requeued.length,
              resent: resent.length,
            })),
            Effect.withSpan("automationPlanner.reap")
          );

      const housekeeping = (at: Temporal.Instant) =>
        db
          .transaction((tx) =>
            Effect.all({
              units: tx
                .delete(units)
                .where(
                  inArray(
                    units.id,
                    tx
                      .select({ id: units.id })
                      .from(units)
                      .where(
                        lt(units.settledAt, at.subtract(settledUnitRetention))
                      )
                      .limit(housekeepingBatchSize)
                  )
                )
                .returning({ id: units.id }),
              previews: tx
                .delete(emailCampaignAutomationPreviews)
                .where(
                  inArray(
                    emailCampaignAutomationPreviews.id,
                    tx
                      .select({ id: emailCampaignAutomationPreviews.id })
                      .from(emailCampaignAutomationPreviews)
                      .where(
                        lt(
                          emailCampaignAutomationPreviews.createdAt,
                          at.subtract(previewRetention)
                        )
                      )
                      .limit(housekeepingBatchSize)
                  )
                )
                .returning({ id: emailCampaignAutomationPreviews.id }),
              // Events still owned by an open intake unit stay until it settles.
              events: tx
                .delete(customerEvents)
                .where(
                  inArray(
                    customerEvents.id,
                    tx
                      .select({ id: customerEvents.id })
                      .from(customerEvents)
                      .where(
                        and(
                          lt(
                            customerEvents.occurredAt,
                            at.subtract(customerEventRetention)
                          ),
                          isNull(customerEvents.automationUnitId)
                        )
                      )
                      .limit(housekeepingBatchSize)
                  )
                )
                .returning({ id: customerEvents.id }),
            })
          )
          .pipe(
            Effect.map((pruned) => ({
              units: pruned.units.length,
              previews: pruned.previews.length,
              events: pruned.events.length,
            })),
            Effect.withSpan("automationPlanner.housekeeping")
          );

      const inFlightByKind = db
        .select({ kind: units.kind, count: sql<number>`count(*)::int` })
        .from(units)
        .where(inArray(units.status, ["enqueued", "claimed"]))
        .groupBy(units.kind)
        .pipe(
          Effect.map((rows) =>
            Object.fromEntries(rows.map((row) => [row.kind, row.count]))
          )
        );

      const failingByKind = db
        .select({ kind: units.kind, count: sql<number>`count(*)::int` })
        .from(units)
        .where(
          and(
            gt(units.failures, 0),
            notInArray(units.status, ["done", "dropped"])
          )
        )
        .groupBy(units.kind)
        .pipe(
          Effect.map((rows) =>
            Object.fromEntries(rows.map((row) => [row.kind, row.count]))
          )
        );

      const recordSummary = (summary: AutomationPlanSummary) =>
        db
          .update(emailCampaignAutomationEngine)
          .set({ lastPlanSummary: summary })
          .where(eq(emailCampaignAutomationEngine.id, 1))
          .pipe(
            Effect.tap(() =>
              Effect.logInfo("Automation engine planned", { summary })
            )
          );

      return {
        plan: Effect.Do.pipe(
          Effect.bind("at", () => currentInstant),
          Effect.tap(({ at }) => heartbeat(at)),
          Effect.bind("reaped", ({ at }) => reap(at)),
          Effect.bind("sweep", ({ at }) =>
            sweepPlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.sweep"))
          ),
          Effect.bind("intake", ({ at }) =>
            intakePlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.intake"))
          ),
          Effect.bind("timers", ({ at }) =>
            timerPlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.timers"))
          ),
          Effect.bind("conditions", ({ at }) =>
            conditionPlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.conditions"))
          ),
          Effect.bind("sends", ({ at }) =>
            sendPlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.sends"))
          ),
          Effect.bind("schedules", ({ at }) =>
            schedulePlanning
              .plan(at)
              .pipe(Effect.withSpan("automationPlanner.schedules"))
          ),
          Effect.bind("pruned", ({ at }) => housekeeping(at)),
          Effect.bind("promoted", () =>
            slots.topUp.pipe(Effect.withSpan("automationPlanner.topUp"))
          ),
          Effect.bind("inFlightByKind", () => inFlightByKind),
          Effect.bind("failingByKind", () => failingByKind),
          Effect.map(
            ({
              at,
              reaped,
              sweep,
              intake,
              timers,
              conditions,
              sends,
              schedules,
              pruned,
              promoted,
              inFlightByKind,
              failingByKind,
            }): AutomationPlanSummary => ({
              plannedAt: at.toString(),
              reaped,
              sweepPagesPlanned: sweep.sweepPagesPlanned,
              sweepPagesReplanned: sweep.sweepPagesReplanned,
              eventsReconciled: sweep.eventsReconciled,
              intake,
              timers,
              conditions,
              sends,
              schedules,
              pruned,
              promoted: promoted.length,
              inFlightByKind,
              failingByKind,
            })
          ),
          Effect.tap(recordSummary),
          Effect.withSpan("automationPlanner.plan")
        ),
      };
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(AutomationUnitSlots.Default),
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDatabaseAdvisoryLock.Default,
        AutomationUnitHandlers.Live,
        AutomationUnitQueue.Default,
        AutomationSweepPlanning.Live,
        AutomationIntakePlanning.Live,
        AutomationTimerPlanning.Live,
        AutomationConditionPlanning.Live,
        AutomationSendPlanning.Live,
        AutomationSchedulePlanning.Live
      )
    )
  );
}
