import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  customerEvents,
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationWorkUnits as units,
} from "@/db/schema";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import { automationWorkUnitPriorities } from "../automation-work-units";
import type { PlannedAutomationUnit } from "./automation-unit-handler";

/**
 * How long a unit that failed n times waits before it is replanned: 1, 2,
 * 4, … minutes, then hourly. The exponent is capped so the interval never
 * overflows. Replanning runs on planner ticks, so a backoff shorter than the
 * cron interval waits for the next tick.
 */
const replanBackoff = sql`least(interval '1 minute' * power(2, least(${units.failures} - 1, 6)), interval '1 hour')`;

/** A failed unit that planning returned to `planned`. */
type ReplannedAutomationUnit = {
  readonly unitId: AutomationWorkUnitId;
  readonly kind: string;
  readonly failures: number;
  readonly lastErrorCode: string | null;
};

/**
 * Inserts units as `planned`, holding no slot. A key that already exists is
 * skipped, so repeated planning is a no-op, except a unit that settled
 * `failed`: once its backoff has passed it returns to `planned` with this
 * plan's subject, so a failed sweep page is retried from its cursor instead
 * of blocking it until housekeeping prunes the unit. Keys insert in order,
 * so overlapping planners never wait on each other in a cycle.
 */
export const planAutomationUnits = Effect.fn("automationUnits.plan")(function* (
  planned: ReadonlyArray<PlannedAutomationUnit>,
  at: Temporal.Instant
) {
  const { db } = yield* WorkspaceTransaction;
  if (planned.length === 0) return { planned: 0, replanned: [], written: [] };

  const written = yield* db
    .insert(units)
    .values(
      planned
        .toSorted((left, right) => left.key.localeCompare(right.key))
        .map((unit) => ({
          kind: unit.kind,
          priority: automationWorkUnitPriorities[unit.kind],
          campaignId: unit.campaignId ?? null,
          key: unit.key,
          subject: unit.subject,
          requestCost: unit.requestCost,
          status: "planned" as const,
        }))
    )
    .onConflictDoUpdate({
      target: units.key,
      set: {
        status: "planned",
        subject: sql`excluded.subject`,
        requestCost: sql`excluded.request_cost`,
        cancelRequestedAt: null,
        enqueuedAt: null,
        settledAt: null,
        // A fresh idempotency key, so the queue accepts the next message.
        enqueueGeneration: sql`${units.enqueueGeneration} + 1`,
      },
      setWhere: and(
        eq(units.status, "failed"),
        lte(
          units.settledAt,
          sql`${sql.param(at, units.settledAt)}::timestamptz - ${replanBackoff}`
        )
      ),
    })
    .returning({
      unitId: units.id,
      key: units.key,
      kind: units.kind,
      failures: units.failures,
      lastErrorCode: units.lastErrorCode,
    });

  // A new row has never failed.
  const replanned: ReadonlyArray<ReplannedAutomationUnit> = written.filter(
    (unit) => unit.failures > 0
  );
  yield* Effect.logWarning("Automation units replanned after failing", {
    units: replanned,
  }).pipe(Effect.when(Effect.succeed(replanned.length > 0)));
  return {
    planned: written.length - replanned.length,
    replanned,
    /** Every unit this call inserted or replanned, so the caller can CAS its subjects' owner. */
    written: written.map(({ unitId, key }) => ({ unitId, key })),
  };
});

/** The subjects a unit owns through `runs.work_unit_id` or `customer_events.automation_unit_id` (§1.2.13). */
const ownedSubjectsSchema = Schema.Struct({
  runIds: Schema.optional(Schema.Array(Schema.String)),
  eventIds: Schema.optional(Schema.Array(Schema.String)),
});

/**
 * Frees the runs and events that settling units still own, so the planner
 * replans them where they stand. Ownership is read from the subject's
 * `runIds` and `eventIds` and cleared by CAS on the unit id, so subjects a
 * commit already released, or that another unit owns, are untouched. Call
 * it before the unit row's settlement CAS, in the same transaction: rows
 * lock in the §5.4 order (runs in id order, then the unit row).
 */
export const releaseAutomationUnitSubjects = Effect.fn(
  "automationUnits.releaseSubjects"
)(function* (
  settling: ReadonlyArray<{
    readonly id: AutomationWorkUnitId;
    readonly subject: unknown;
  }>
) {
  const { db } = yield* WorkspaceTransaction;
  const owned = settling.flatMap((unit) =>
    Option.match(
      Schema.decodeUnknownOption(ownedSubjectsSchema)(unit.subject),
      {
        onNone: () => [],
        onSome: (subject) => [{ unitId: unit.id, ...subject }],
      }
    )
  );
  const runOwners = owned
    .flatMap(({ unitId, runIds = [] }) =>
      runIds.map((runId) => ({ unitId, runId }))
    )
    .toSorted((left, right) => left.runId.localeCompare(right.runId));

  if (runOwners.length > 0) {
    const locked = yield* db
      .select({ id: runs.id, workUnitId: runs.workUnitId })
      .from(runs)
      .where(
        inArray(
          runs.id,
          runOwners.map(({ runId }) => runId as typeof runs.$inferSelect.id)
        )
      )
      .orderBy(runs.id)
      .for("update");
    const released = locked.filter((run) =>
      runOwners.some(
        (owner) => owner.runId === run.id && owner.unitId === run.workUnitId
      )
    );
    if (released.length > 0) {
      yield* db
        .update(runs)
        .set({ workUnitId: null })
        .where(
          inArray(
            runs.id,
            released.map((run) => run.id)
          )
        );
    }
  }
  yield* Effect.forEach(
    owned.filter(({ eventIds = [] }) => eventIds.length > 0),
    ({ unitId, eventIds = [] }) =>
      db
        .update(customerEvents)
        .set({ automationUnitId: null })
        .where(
          and(
            inArray(
              customerEvents.id,
              eventIds as Array<typeof customerEvents.$inferSelect.id>
            ),
            eq(customerEvents.automationUnitId, unitId)
          )
        ),
    { discard: true }
  );
});
