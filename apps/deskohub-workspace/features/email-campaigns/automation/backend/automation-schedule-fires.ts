import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, eq, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  emailCampaignAutomations as automations,
  emailCampaignAutomationScheduleFires as fires,
} from "@/db/schema";
import { WorkspaceLocks } from "@/db/workspace-locks";
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
import type { PlannedAutomationUnit } from "./automation-unit-handler";
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
export const lockScheduleFireEntry = (campaignId: CampaignId) =>
  WorkspaceLocks.automationFireEntry(campaignId);

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
  function* (input: {
    readonly campaignId: CampaignId;
    readonly fireAt: Temporal.Instant;
    readonly status: "entered" | "failed";
    readonly versions: readonly AutomationVersionActivation[];
    readonly at: Temporal.Instant;
  }) {
    const { db } = yield* WorkspaceTransaction;
    yield* db
      .update(fires)
      .set({ status: input.status, settledAt: input.at })
      .where(
        and(
          eq(fires.campaignId, input.campaignId),
          eq(fires.fireAt, input.fireAt),
          eq(fires.status, "entering")
        )
      );
    return yield* advanceNextFire(input);
  }
);

/**
 * Moves `next_fire_at` from `fireAt` to the next scheduled fire by
 * compare-and-set; None when there is none or another writer moved it.
 */
const advanceNextFire = (input: {
  readonly campaignId: CampaignId;
  readonly fireAt: Temporal.Instant;
  readonly versions: readonly AutomationVersionActivation[];
}) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .update(automations)
      .set({
        nextFireAt: Option.getOrNull(
          nextFireAfter(input.versions, input.fireAt)
        ),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(automations.campaignId, input.campaignId),
          eq(automations.nextFireAt, input.fireAt)
        )
      )
      .returning({ nextFireAt: automations.nextFireAt })
      .pipe(Effect.map(([row]) => Option.fromNullishOr(row?.nextFireAt)))
  );

/** `F` is due at `at` and falls in the automation's accepting window. */
const isDueFire = (
  fireAt: Option.Option<Temporal.Instant>,
  at: Temporal.Instant,
  acceptingSince: Temporal.Instant
): fireAt is Option.Some<Temporal.Instant> =>
  Option.isSome(fireAt) &&
  Temporal.Instant.compare(fireAt.value, at) <= 0 &&
  Temporal.Instant.compare(fireAt.value, acceptingSince) >= 0;

/** The entry version of the automation version in force at `F`. */
const entryVersionAt = Effect.fnUntraced(function* (
  versions: readonly AutomationVersionActivation[],
  fireAt: Temporal.Instant
) {
  const inForce = versionInForce(versions, fireAt);
  if (Option.isNone(inForce)) return Option.none();
  const loaded = yield* loadAutomationEntryVersions([inForce.value.id]);
  return Option.fromNullishOr(loaded.get(inForce.value.id));
});

/**
 * What creating one fire did: nothing (no version, or the fire exists),
 * entered at once with an empty pool, or entering with its chunks planned.
 */
type FireCreation =
  | { readonly _tag: "Stopped" }
  | { readonly _tag: "Entered" }
  | { readonly _tag: "Entering"; readonly chunksPlanned: number };

const stopped: FireCreation = { _tag: "Stopped" };

/** Counts one fire creation into the call's plan. */
const addFireCreation = (
  plan: ScheduleFirePlan,
  creation: FireCreation
): ScheduleFirePlan => {
  switch (creation._tag) {
    case "Stopped":
      return plan;
    case "Entered":
      return {
        ...plan,
        firesCreated: plan.firesCreated + 1,
        firesEntered: plan.firesEntered + 1,
      };
    case "Entering":
      return {
        ...plan,
        firesCreated: plan.firesCreated + 1,
        chunksPlanned: plan.chunksPlanned + creation.chunksPlanned,
      };
  }
};

/**
 * Inserts the fire `F` for the version in force at it, packing its pool
 * into chunks: entered at once when the pool is empty, else entering with
 * one fire-chunk unit per chunk.
 */
const createFire = Effect.fnUntraced(function* (input: {
  readonly campaignId: CampaignId;
  readonly fireAt: Temporal.Instant;
  readonly at: Temporal.Instant;
  readonly versions: readonly AutomationVersionActivation[];
}) {
  const { campaignId, fireAt: F, at } = input;
  const { db } = yield* WorkspaceTransaction;
  const facts = yield* AutomationEvaluationFacts;
  const inForce = yield* entryVersionAt(input.versions, F);
  if (Option.isNone(inForce)) return stopped;
  const version = inForce.value;

  const pool = yield* listCampaignCandidateIds(db, version.purpose);
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
  const inserted = yield* db
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
    return stopped;
  }
  if (chunks.length === 0) return { _tag: "Entered" } satisfies FireCreation;
  const planned = yield* planAutomationUnits(
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
  return {
    _tag: "Entering",
    chunksPlanned: planned.written.length,
  } satisfies FireCreation;
});

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
  function* (campaignId: CampaignId, at: Temporal.Instant) {
    const { db } = yield* WorkspaceTransaction;
    yield* lockScheduleFireEntry(campaignId);
    const state = yield* lockAutomationForEngine(campaignId);
    if (state.status !== "active" || state.acceptingSince === null) {
      return noFires;
    }
    const acceptingSince = state.acceptingSince;
    const versions = yield* loadAutomationVersionActivations(campaignId);
    const [entering] = yield* db
      .select({ fireAt: fires.fireAt })
      .from(fires)
      .where(
        and(eq(fires.campaignId, campaignId), eq(fires.status, "entering"))
      );
    if (entering !== undefined) return noFires;

    let plan = noFires;
    let fireAt = Option.fromNullishOr(state.nextFireAt);
    for (let created = 0; created < maxFiresPerCall; created++) {
      if (!isDueFire(fireAt, at, acceptingSince)) break;
      const F = fireAt.value;
      const creation = yield* createFire({
        campaignId,
        fireAt: F,
        at,
        versions,
      });
      plan = addFireCreation(plan, creation);
      if (creation._tag !== "Entered") break;
      fireAt = yield* advanceNextFire({ campaignId, fireAt: F, versions });
    }
    return plan;
  }
);
