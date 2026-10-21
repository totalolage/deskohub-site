import { and, eq, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { emailCampaignAutomationWorkUnits as units } from "@/db/schema";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import { automationWorkUnitPriorities } from "../automation-work-units";
import type {
  AutomationEngineTransaction,
  PlannedAutomationUnit,
} from "./automation-unit-handler";

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
  tx: AutomationEngineTransaction,
  planned: ReadonlyArray<PlannedAutomationUnit>,
  at: Temporal.Instant
) {
  if (planned.length === 0) return { planned: 0, replanned: [] };

  const written = yield* tx
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
  return { planned: written.length - replanned.length, replanned };
});
