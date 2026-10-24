import "server-only";

import {
  type AutomationEngineWarningType,
  AutomationTrigger,
  type AutomationEngineHealthType as EngineHealthReport,
  emailAutomationTickMinutes,
} from "@deskohub/workspace-admin-api";
import {
  and,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  max,
  min,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { Array as Arr, Context, Effect, Layer, Option, Schema } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  emailCampaignAutomations as automations,
  customerEventSweeps,
  customerEvents,
  emailCampaignAutomationEngine as engine,
  emailCampaignAutomationScheduleFires as fires,
  emailCampaignAutomationWorkUnits as units,
  emailCampaignAutomationVersions as versions,
  workspaceReservations,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { countedReservationCondition } from "@/features/reservation/backend/reservation-visits.service";
import type { CustomerEventSweepSource } from "@/shared/backend/customer-events/customer-event";
import { currentInstant } from "@/shared/utils/temporal";
import type { CampaignId } from "../../campaign-identifiers";
import {
  type AutomationVersionActivation,
  nextFireAfter,
} from "../automation-versions";
import { soloUnitBookingThreshold } from "./automation-evaluation-facts.service";

interface IAutomationEngineHealth {
  /**
   * The engine's lags, backlogs and unit durations now, with the warnings
   * the run log shows. Local reads only: no Dotypos call, no customer data.
   */
  readonly get: Effect.Effect<EngineHealthReport, DatabaseQueryError>;
}

const tickSeconds = emailAutomationTickMinutes * 60;

/**
 * The planner runs every tick. Two ticks without a run is stale, so one
 * missed or late cron doesn't raise it.
 */
const plannerStaleAfterSeconds = 2 * tickSeconds;
/**
 * The sweep or an unprocessed event waiting longer than this is a backlog.
 * An event normally waits up to a tick for intake, so a backlog is one that
 * outlasts the next tick too.
 */
const backlogAfterSeconds = 2 * tickSeconds;
/**
 * The reconcile re-pages the last 24 hours on the first tick of each
 * Workspace hour (`dueReservationActivityWindow`) and pages that window
 * within the tick, so its last completed window opened at most about an hour
 * ago on a healthy engine. It has stalled once a whole hour passes without
 * one and the next hour's hasn't completed within its first tick either. One
 * missed hour is tolerated, as one missed tick is for the planner.
 */
const reconcileIntervalSeconds = 60 * 60;
const reconcileStalledAfterSeconds = 2 * reconcileIntervalSeconds + tickSeconds;
/**
 * A planned unit waiting longer than this is a backlog. Slots hand off as
 * units settle, between ticks too, so this doesn't scale with the tick.
 */
const unitBacklogAfterSeconds = 15 * 60;
/** A schedule whose oldest pending fire trails now by more than this lags. */
const scheduleLaggingAfterSeconds = 10 * 60;
/**
 * Unit durations sample the last hour of units settled `done` on their
 * first attempt, so one sample is one claim to its settlement.
 */
const unitDurationWindow = { hours: 1 } as const;

/** Reads the automation engine's health for the run log and `dhw`. */
export class AutomationEngineHealth extends Context.Service<
  AutomationEngineHealth,
  IAutomationEngineHealth
>()("@deskohub-workspace/email-campaigns/AutomationEngineHealth") {
  static Default = Layer.effect(
    this,
    Effect.map(WorkspaceDatabase, ({ db }) => ({
      get: Effect.Do.pipe(
        Effect.bind("now", () => currentInstant),
        Effect.bind("reads", ({ now }) => readHealth(db, now)),
        Effect.map(({ now, reads }) => healthReport(now, reads)),
        Effect.withSpan("AutomationEngineHealth.get")
      ),
    }))
  );
}

const readHealth = (db: WorkspaceDatabaseClient, now: Temporal.Instant) =>
  Effect.all(
    {
      lastPlannedAt: db
        .select({ lastPlannedAt: engine.lastPlannedAt })
        .from(engine)
        .where(eq(engine.id, 1))
        .pipe(Effect.map(([row]) => row?.lastPlannedAt ?? null)),
      // Only the clock sweep trails now: the hourly reconcile's cursor is
      // the instant its last window opened, up to an hour old when healthy.
      sweptUntil: sweptUntil(db, "reservation-activity"),
      reconciledUntil: sweptUntil(db, "reservation-activity-reconcile"),
      oldestUnprocessedEventAt: db
        .select({ recordedAt: min(customerEvents.recordedAt) })
        .from(customerEvents)
        .where(isNull(customerEvents.automationProcessedAt))
        .pipe(Effect.map(([row]) => row?.recordedAt ?? null)),
      schedules: readSchedules(db),
      unitDurations: db
        .select({
          kind: units.kind,
          samples: count(),
          meanSeconds: sql<number>`avg(${unitSeconds})`.mapWith(Number),
          maxSeconds: sql<number>`max(${unitSeconds})`.mapWith(Number),
        })
        .from(units)
        .where(
          and(
            eq(units.status, "done"),
            eq(units.attempts, 1),
            isNotNull(units.firstAttemptAt),
            gte(units.settledAt, now.subtract(unitDurationWindow))
          )
        )
        .groupBy(units.kind)
        .orderBy(units.kind),
      units: db
        .select({ kind: units.kind, status: units.status, count: count() })
        .from(units)
        .groupBy(units.kind, units.status)
        .orderBy(units.kind, units.status),
      oldestPlannedUnitAt: db
        .select({ createdAt: min(units.createdAt) })
        .from(units)
        .where(eq(units.status, "planned"))
        .pipe(Effect.map(([row]) => row?.createdAt ?? null)),
      retryingUnits: db
        .select({
          kind: units.kind,
          errorCode: units.lastErrorCode,
          count: count(),
        })
        .from(units)
        .where(
          and(eq(units.status, "enqueued"), isNotNull(units.lastErrorCode))
        )
        .groupBy(units.kind, units.lastErrorCode)
        .orderBy(units.kind, units.lastErrorCode),
      deadlineMisses: db
        .select({ misses: sum(units.deadlineMisses).mapWith(Number) })
        .from(units)
        .pipe(Effect.map(([row]) => row?.misses ?? 0)),
      largestCustomerBookedCount: largestCustomerBookedCount(db),
    },
    { concurrency: "inherit" }
  );

type HealthReads = Effect.Success<ReturnType<typeof readHealth>>;

/** A sweep source's cursor, or null without its row. */
const sweptUntil = (
  db: WorkspaceDatabaseClient,
  source: CustomerEventSweepSource
) =>
  db
    .select({ sweptUntil: customerEventSweeps.sweptUntil })
    .from(customerEventSweeps)
    .where(eq(customerEventSweeps.source, source))
    .pipe(Effect.map(([row]) => row?.sweptUntil ?? null));

/** One claim's duration: from its first attempt to its settlement. */
const unitSeconds = sql`extract(epoch from ${units.settledAt} - ${units.firstAttemptAt})`;

/**
 * The automations a schedule health line covers: not archived, and with a
 * pending fire or a recorded one.
 */
const readSchedules = (db: WorkspaceDatabaseClient) =>
  Effect.Do.pipe(
    Effect.bind("automations", () =>
      db
        .select({
          campaignId: automations.campaignId,
          nextFireAt: automations.nextFireAt,
        })
        .from(automations)
        .where(
          and(
            isNull(automations.archivedAt),
            or(
              isNotNull(automations.nextFireAt),
              exists(
                db
                  .select({ fireAt: fires.fireAt })
                  .from(fires)
                  .where(eq(fires.campaignId, automations.campaignId))
              )
            )
          )
        )
        .orderBy(automations.campaignId)
    ),
    Effect.let("campaignIds", ({ automations }) =>
      automations.map(({ campaignId }) => campaignId)
    ),
    Effect.bind("enteringFires", ({ campaignIds }) =>
      db
        .select({
          campaignId: fires.campaignId,
          fireAt: fires.fireAt,
          chunksDone: fires.chunksDone,
          chunksTotal: fires.chunksTotal,
        })
        .from(fires)
        .where(
          and(
            inArray(fires.campaignId, campaignIds),
            eq(fires.status, "entering")
          )
        )
    ),
    Effect.bind("lastFires", ({ campaignIds }) =>
      db
        .selectDistinctOn([fires.campaignId], {
          campaignId: fires.campaignId,
          fireAt: fires.fireAt,
          createdAt: fires.createdAt,
          settledAt: fires.settledAt,
        })
        .from(fires)
        .where(
          and(
            inArray(fires.campaignId, campaignIds),
            eq(fires.status, "entered")
          )
        )
        .orderBy(fires.campaignId, sql`${fires.fireAt} desc`)
    ),
    Effect.bind("versions", ({ campaignIds }) =>
      db
        .select({
          campaignId: versions.campaignId,
          id: versions.id,
          activatedAt: versions.activatedAt,
          flow: versions.flow,
        })
        .from(versions)
        .where(inArray(versions.campaignId, campaignIds))
    ),
    Effect.map(({ automations, enteringFires, lastFires, versions }) =>
      automations.map((automation) => ({
        ...automation,
        enteringFire: Arr.findFirst(
          enteringFires,
          (fire) => fire.campaignId === automation.campaignId
        ),
        lastFire: Arr.findFirst(
          lastFires,
          (fire) => fire.campaignId === automation.campaignId
        ),
        versions: versions.flatMap((version) =>
          version.campaignId === automation.campaignId
            ? Option.toArray(versionActivation(version))
            : []
        ),
      }))
    )
  );

const decodeStoredTrigger = Schema.decodeUnknownOption(
  Schema.Struct({ trigger: AutomationTrigger })
);

/**
 * A version's activation with its trigger; none when its stored flow no
 * longer decodes, so the fire interval it would set reads as unknown.
 */
const versionActivation = (version: {
  readonly id: AutomationVersionActivation["id"];
  readonly activatedAt: Temporal.Instant;
  readonly flow: unknown;
}): Option.Option<AutomationVersionActivation> =>
  Option.map(decodeStoredTrigger(version.flow), ({ trigger }) => ({
    id: version.id,
    activatedAt: version.activatedAt,
    trigger,
  }));

/** The most bookings one customer has, counted as unit packing counts them. */
const largestCustomerBookedCount = (db: WorkspaceDatabaseClient) => {
  const bookings = db
    .select({ booked: count().as("booked") })
    .from(workspaceReservations)
    .where(countedReservationCondition)
    .groupBy(workspaceReservations.dotyposCustomerId)
    .as("bookings");
  return db
    .select({ largest: max(bookings.booked).mapWith(Number) })
    .from(bookings)
    .pipe(Effect.map(([row]) => row?.largest ?? null));
};

const secondsSince = (now: Temporal.Instant, then: Temporal.Instant) =>
  (now.epochMilliseconds - then.epochMilliseconds) / 1000;

const healthReport = (
  now: Temporal.Instant,
  reads: HealthReads
): EngineHealthReport => {
  const sweepLagSeconds =
    reads.sweptUntil === null ? null : secondsSince(now, reads.sweptUntil);
  const reconcileLagSeconds =
    reads.reconciledUntil === null
      ? null
      : secondsSince(now, reads.reconciledUntil);
  const schedules = reads.schedules.map((schedule) =>
    scheduleHealth(now, schedule)
  );
  const waitedLongerThan = (
    at: Temporal.Instant | null,
    seconds: number
  ): boolean => at !== null && secondsSince(now, at) > seconds;
  return {
    lastPlannedAt: reads.lastPlannedAt?.toString() ?? null,
    sweepLagSeconds,
    reconcileLagSeconds,
    oldestUnprocessedEventAt:
      reads.oldestUnprocessedEventAt?.toString() ?? null,
    automations: schedules,
    unitDurations: reads.unitDurations,
    units: reads.units,
    oldestPlannedUnitAt: reads.oldestPlannedUnitAt?.toString() ?? null,
    retryingUnits: reads.retryingUnits,
    deadlineMisses: reads.deadlineMisses,
    largestCustomerBookedCount: reads.largestCustomerBookedCount,
    soloThreshold: soloUnitBookingThreshold,
    warnings: [
      ...(reads.lastPlannedAt === null ||
      waitedLongerThan(reads.lastPlannedAt, plannerStaleAfterSeconds)
        ? (["planner-stale"] as const)
        : []),
      ...(sweepLagSeconds !== null && sweepLagSeconds > backlogAfterSeconds
        ? (["sweep-lagging"] as const)
        : []),
      // Without its cursor row the reconcile never runs.
      ...(reconcileLagSeconds === null ||
      reconcileLagSeconds > reconcileStalledAfterSeconds
        ? (["reconcile-stalled"] as const)
        : []),
      ...(waitedLongerThan(reads.oldestUnprocessedEventAt, backlogAfterSeconds)
        ? (["event-backlog"] as const)
        : []),
      ...(waitedLongerThan(reads.oldestPlannedUnitAt, unitBacklogAfterSeconds)
        ? (["unit-backlog"] as const)
        : []),
      ...(schedules.some(
        ({ scheduleLagSeconds }) =>
          scheduleLagSeconds !== null &&
          scheduleLagSeconds > scheduleLaggingAfterSeconds
      )
        ? (["schedule-lagging"] as const)
        : []),
      ...(schedules.some(({ lastFire }) => lastFire?.fallingBehind)
        ? (["falling-behind"] as const)
        : []),
    ] satisfies ReadonlyArray<AutomationEngineWarningType>,
  };
};

type ScheduleReads = HealthReads["schedules"][number];

/**
 * One automation's schedule: how far its oldest fire not yet entered (the
 * entering one, else `next_fire_at` once due) trails now, the entering
 * fire's chunks, and how long the last entered fire took, from its creation
 * to its settlement, against the interval to the fire after it.
 */
const scheduleHealth = (
  now: Temporal.Instant,
  schedule: ScheduleReads
): EngineHealthReport["automations"][number] => {
  const oldestPending = Option.getOrNull(
    Option.orElse(
      Option.map(schedule.enteringFire, ({ fireAt }) => fireAt),
      () => Option.fromNullishOr(schedule.nextFireAt)
    )
  );
  return {
    campaignId: schedule.campaignId satisfies CampaignId,
    scheduleLagSeconds:
      oldestPending === null
        ? null
        : Math.max(0, secondsSince(now, oldestPending)),
    enteringFire: Option.getOrNull(
      Option.map(schedule.enteringFire, (fire) => ({
        fireAt: fire.fireAt.toString(),
        chunksDone: fire.chunksDone,
        chunksTotal: fire.chunksTotal,
      }))
    ),
    lastFire: Option.getOrNull(
      Option.map(schedule.lastFire, (fire) => {
        const durationSeconds = secondsSince(
          fire.settledAt ?? fire.createdAt,
          fire.createdAt
        );
        const intervalSeconds = Option.getOrNull(
          Option.map(nextFireAfter(schedule.versions, fire.fireAt), (next) =>
            secondsSince(next, fire.fireAt)
          )
        );
        return {
          fireAt: fire.fireAt.toString(),
          durationSeconds,
          intervalSeconds,
          fallingBehind:
            intervalSeconds !== null && durationSeconds > intervalSeconds,
        };
      })
    ),
  };
};
