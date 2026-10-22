import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { postgresAdvisoryTransactionLockStatement } from "@/db/postgres-advisory-lock";
import {
  emailCampaignAutomations as automations,
  emailCampaignAutomationScheduleFires as fires,
} from "@/db/schema";
import {
  instantFromIsoStringSchema,
  temporalInstantToIsoString,
} from "@/shared/utils/temporal";
import { audienceEvaluationAt } from "../../backend/audience-evaluation-context";
import { listCampaignCandidateIds } from "../../backend/campaign-candidate.repository";
import type { CampaignId } from "../../campaign-identifiers";
import {
  type AutomationVersionActivation,
  nextFireAfter,
  versionInForce,
} from "../automation-versions";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { loadAutomationEntryVersions } from "./automation-run-entry";
import type {
  AutomationEngineTransaction,
  PlannedAutomationUnit,
} from "./automation-unit-handler";
import { planAutomationUnits } from "./automation-unit-planning";
import { loadAutomationVersionActivations } from "./automation-version-activations";

/** The most fires one `planNextFire` call creates, chaining empty pools (§5.7). */
const maxFiresPerCall = 60;

export const fireChunkSubjectSchema = Schema.Struct({
  fireAt: instantFromIsoStringSchema,
  customerIds: Schema.Array(Schema.String),
});
export type FireChunkSubject = typeof fireChunkSubjectSchema.Type;

/** The receipt key of one customer entering one fire (§1.2.7). */
export const scheduleDedupKey = (
  fireAt: Temporal.Instant,
  customerId: DotyposCustomerId
) => `schedule:${temporalInstantToIsoString(fireAt)}:${customerId}`;

/**
 * Serialises the transactions that enter one automation's fires: planning
 * a fire and committing its chunks. Taken before the lifecycle lock, so the
 * commit completing a fire can advance `next_fire_at` without waiting on a
 * sibling chunk that holds the lifecycle lock shared and waits for the fire
 * row. Lifecycle operations don't take it.
 */
export const lockScheduleFireEntry = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId
) =>
  tx.execute(
    postgresAdvisoryTransactionLockStatement([
      "email-automation-fire-entry",
      campaignId,
    ])
  );

/** What `planNextFire` did. */
export type ScheduleFirePlan = {
  readonly firesCreated: number;
  readonly firesEntered: number;
  readonly chunksPlanned: number;
};

const noFires: ScheduleFirePlan = {
  firesCreated: 0,
  firesEntered: 0,
  chunksPlanned: 0,
};

/**
 * Settles an `entering` fire `entered` and moves `next_fire_at` from it to
 * the next scheduled fire, never to now, so missed fires replay in order
 * (D34). Call it under the fire-entry and lifecycle locks.
 */
export const enterScheduleFire = Effect.fn("automationSchedules.enterFire")(
  function* (
    tx: AutomationEngineTransaction,
    input: {
      readonly campaignId: CampaignId;
      readonly fireAt: Temporal.Instant;
      readonly status: "entered" | "failed";
      readonly versions: readonly AutomationVersionActivation[];
      readonly at: Temporal.Instant;
    }
  ) {
    yield* tx
      .update(fires)
      .set({ status: input.status, settledAt: input.at })
      .where(
        and(
          eq(fires.campaignId, input.campaignId),
          eq(fires.fireAt, input.fireAt),
          eq(fires.status, "entering")
        )
      );
    return yield* advanceNextFire(tx, input);
  }
);

/**
 * Moves `next_fire_at` from `fireAt` to the next scheduled fire by
 * compare-and-set; None when there is none or another writer moved it.
 */
const advanceNextFire = (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly fireAt: Temporal.Instant;
    readonly versions: readonly AutomationVersionActivation[];
  }
) =>
  tx
    .update(automations)
    .set({
      nextFireAt: Option.getOrNull(nextFireAfter(input.versions, input.fireAt)),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automations.campaignId, input.campaignId),
        eq(automations.nextFireAt, input.fireAt)
      )
    )
    .returning({ nextFireAt: automations.nextFireAt })
    .pipe(Effect.map(([row]) => Option.fromNullishOr(row?.nextFireAt)));

/**
 * Creates the automation's due fires in the caller's transaction (§5.7):
 * while `next_fire_at` is due and no fire is entering, it inserts the fire
 * for the version in force at `F` with one fire-chunk unit per packed chunk
 * of the pool (one-off sends' pool rules, consent pool included, in id
 * order). An empty pool enters the fire at once and continues with the
 * next one, up to 60 fires. Rechecks `status='active'` and
 * `fire_at ≥ accepting_since` under the lifecycle lock.
 */
export const planNextFire = Effect.fn("automationSchedules.planNextFire")(
  function* (
    tx: AutomationEngineTransaction,
    campaignId: CampaignId,
    at: Temporal.Instant
  ) {
    const facts = yield* AutomationEvaluationFacts;
    yield* lockScheduleFireEntry(tx, campaignId);
    const state = yield* lockAutomationForEngine(tx, campaignId);
    if (state.status !== "active" || state.acceptingSince === null) {
      return noFires;
    }
    const acceptingSince = state.acceptingSince;
    const versions = yield* loadAutomationVersionActivations(tx, campaignId);
    const [entering] = yield* tx
      .select({ fireAt: fires.fireAt })
      .from(fires)
      .where(
        and(eq(fires.campaignId, campaignId), eq(fires.status, "entering"))
      );
    if (entering !== undefined) return noFires;

    let plan = noFires;
    let fireAt = Option.fromNullishOr(state.nextFireAt);
    for (let created = 0; created < maxFiresPerCall; created++) {
      if (
        Option.isNone(fireAt) ||
        Temporal.Instant.compare(fireAt.value, at) > 0 ||
        Temporal.Instant.compare(fireAt.value, acceptingSince) < 0
      ) {
        break;
      }
      const F = fireAt.value;
      const inForce = versionInForce(versions, F);
      if (Option.isNone(inForce)) break;
      const version = (yield* loadAutomationEntryVersions(tx, [
        inForce.value.id,
      ])).get(inForce.value.id);
      if (version === undefined) break;

      const pool = yield* listCampaignCandidateIds(tx, version.purpose);
      const { reads } = yield* facts
        .plan({
          filters: {
            entryAudience: version.audienceFilter,
            reachability: true,
          },
          context: audienceEvaluationAt(at),
        })
        .pipe(Effect.orDie);
      const chunks = yield* facts.pack({ reads, customers: pool });
      const inserted = yield* tx
        .insert(fires)
        .values({
          campaignId,
          fireAt: F,
          versionId: version.id,
          status: chunks.length === 0 ? "entered" : "entering",
          chunksTotal: chunks.length,
          // The engine's instant, as `settled_at`, so health's fire duration
          // compares one clock.
          createdAt: at,
          settledAt: chunks.length === 0 ? at : null,
        })
        .onConflictDoNothing()
        .returning({ fireAt: fires.fireAt });
      if (inserted.length === 0) {
        // `next_fire_at` already passed F once; never enter a fire twice.
        yield* Effect.logWarning("Schedule fire already exists", {
          campaignId,
          fireAt: temporalInstantToIsoString(F),
        });
        break;
      }
      if (chunks.length > 0) {
        const planned = yield* planAutomationUnits(
          tx,
          chunks.map(
            (chunk, index): PlannedAutomationUnit => ({
              kind: "fire-chunk",
              key: `fire-chunk:${campaignId}:${temporalInstantToIsoString(F)}:${index}`,
              campaignId,
              subject: Schema.encodeSync(fireChunkSubjectSchema)({
                fireAt: F,
                customerIds: [...chunk.customers],
              }),
              requestCost: chunk.requestCost,
            })
          ),
          at
        );
        plan = {
          ...plan,
          firesCreated: plan.firesCreated + 1,
          chunksPlanned: plan.chunksPlanned + planned.written.length,
        };
        break;
      }
      plan = {
        ...plan,
        firesCreated: plan.firesCreated + 1,
        firesEntered: plan.firesEntered + 1,
      };
      const next = yield* advanceNextFire(tx, {
        campaignId,
        fireAt: F,
        versions,
      });
      fireAt = next;
    }
    return plan;
  }
);
