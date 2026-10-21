import type { DotyposCustomerId } from "@deskohub/dotypos";
import { dotyposIdFilterBatchSize } from "@deskohub/dotypos";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerEvents,
  emailCampaignAutomationRuns as runs,
} from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { audienceEvaluationAt } from "../../backend/audience-evaluation-context";
import type { AudienceDotyposReads } from "../../backend/audience-facts.service";
import type { AutomationRunId } from "../automation-identifiers";
import { automationTickAtOrBefore } from "../automation-ticks";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import {
  type IntakeMatch,
  intakeEventColumns,
  matchIntakeEvents,
} from "./automation-intake-matching";
import { lockAutomationForEngine } from "./automation-lifecycle-lock";
import { loadAutomationEntryVersions } from "./automation-run-entry";
import { AutomationRunTransitions } from "./automation-run-transitions";
import type { AutomationEngineTransaction } from "./automation-unit-handler";
import { planAutomationUnits } from "./automation-unit-planning";
import { plannedIntakeUnit, revisitedReservations } from "./intake";

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

/** The most unplanned events one planner run matches (§5.5). */
const intakeBatchSize = 2000;

/** The most runs one planner run withdraws; the next planner run takes the rest. */
const withdrawalBatchSize = 5000;

/**
 * D28: the runs a `reservation-cancelled` event withdraws, its
 * reservation's `active` runs except those a cancellation triggered.
 */
const withdrawableRuns = and(
  eq(runs.triggerReservationId, customerEvents.workspaceReservationId),
  eq(runs.status, "active"),
  ne(runs.triggerKind, "reservation-cancelled")
);

/** The most Dotypos requests one packed unit makes (§5.3). */
const maxUnitRequestCost = 8;

interface IAutomationIntakePlanning {
  /**
   * Planner step 4 (§5.6): withdraws the active runs of each unprocessed `reservation-cancelled` event's reservation, up to 5,000 per run, matches up to 2,000 unplanned events against active automations, marks events matching nothing processed, and packs the rest by customer into intake units. A cancellation waits for its withdrawals before intake takes it. Runs its own short idempotent transactions, so overlapping
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
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const facts = yield* AutomationEvaluationFacts;

      /**
       * D28: each unprocessed cancellation ends its withdrawable runs.
       * `sending` runs are in a persisted batch and settle normally. One
       * short transaction per automation, under its lifecycle lock. Intake
       * leaves a cancellation unprocessed until none remain, so runs past
       * the batch are withdrawn by subsequent planner runs.
       */
      const withdraw = (at: Temporal.Instant) =>
        db
          .selectDistinct({ campaignId: runs.campaignId, runId: runs.id })
          .from(runs)
          .innerJoin(customerEvents, withdrawableRuns)
          .where(
            and(
              eq(customerEvents.kind, "reservation-cancelled"),
              isNull(customerEvents.automationProcessedAt)
            )
          )
          .orderBy(asc(runs.campaignId), asc(runs.id))
          .limit(withdrawalBatchSize)
          .pipe(
            Effect.flatMap((withdrawn) =>
              Effect.forEach(
                Map.groupBy(withdrawn, ({ campaignId }) => campaignId),
                ([campaignId, ofCampaign]) =>
                  db.transaction((tx) =>
                    lockAutomationForEngine(tx, campaignId).pipe(
                      Effect.andThen(
                        AutomationRunTransitions.end(tx, {
                          runIds: ofCampaign.map(
                            ({ runId }): AutomationRunId => runId
                          ),
                          expect: { status: "active" },
                          outcome: "withdrawn",
                          at,
                        })
                      )
                    )
                  )
              )
            ),
            Effect.map((ended) => ended.flat().length),
            Effect.withSpan("AutomationIntakePlanning.withdraw")
          );

      /** The Dotypos reads the entry gates of these versions need, together. */
      const gateReads = (
        tx: AutomationEngineTransaction,
        matches: readonly IntakeMatch[],
        at: Temporal.Instant
      ) =>
        loadAutomationEntryVersions(
          tx,
          matches.map(({ versionId }) => versionId)
        ).pipe(
          Effect.flatMap((versions) =>
            Effect.forEach(versions.values(), (version) =>
              facts
                .plan({
                  filters: { entryAudience: version.audienceFilter },
                  context: audienceEvaluationAt(at),
                })
                .pipe(Effect.orDie)
            )
          ),
          Effect.map(
            (plans): AudienceDotyposReads => ({
              visits: plans.some(({ reads }) => reads.visits),
              profiles: plans.some(({ reads }) => reads.profiles),
            })
          )
        );

      /**
       * Packs the matched events by customer, in id order, into units of
       * at most 50 customers and 8 requests: the gates' reads plus, unless
       * the gates read the customers' visits anyway, one request per 50
       * triggering reservations to re-check. A customer too large for any
       * unit alone stays a solo unit.
       */
      const pack = (
        matches: readonly IntakeMatch[],
        reads: AudienceDotyposReads
      ) => {
        const byCustomer = Map.groupBy(
          matches,
          ({ event }) => event.dotyposCustomerId
        );
        const customers = [...byCustomer.keys()].sort();
        const revisitCost = (ofCustomers: readonly DotyposCustomerId[]) =>
          reads.visits
            ? 0
            : Math.ceil(
                revisitedReservations(
                  ofCustomers.flatMap((id) =>
                    (byCustomer.get(id) ?? []).map(({ event }) => event)
                  )
                ).length / dotyposIdFilterBatchSize
              );
        const fit = (chunk: {
          readonly customers: readonly DotyposCustomerId[];
          readonly requestCost: number;
        }): Effect.Effect<
          readonly {
            readonly customers: readonly DotyposCustomerId[];
            readonly requestCost: number;
          }[]
        > => {
          const requestCost = chunk.requestCost + revisitCost(chunk.customers);
          if (
            requestCost <= maxUnitRequestCost ||
            chunk.customers.length === 1
          ) {
            return Effect.succeed([
              { customers: chunk.customers, requestCost },
            ]);
          }
          const half = Math.ceil(chunk.customers.length / 2);
          return Effect.forEach(
            [chunk.customers.slice(0, half), chunk.customers.slice(half)],
            (part) =>
              facts
                .cost({ reads, customers: part })
                .pipe(
                  Effect.flatMap((cost) =>
                    fit({ customers: part, requestCost: cost })
                  )
                )
          ).pipe(Effect.map((parts) => parts.flat()));
        };
        return facts.pack({ reads, customers }).pipe(
          Effect.flatMap(Effect.forEach(fit)),
          Effect.map((chunks) =>
            chunks.flat().map((chunk) => ({
              requestCost: chunk.requestCost,
              eventIds: [
                ...new Set(
                  chunk.customers.flatMap((id) =>
                    (byCustomer.get(id) ?? []).map(({ event }) => event.id)
                  )
                ),
              ].sort(),
            }))
          )
        );
      };

      /**
       * One transaction: locks up to 2,000 unplanned events that occurred
       * by the tick `at` falls in (skipping those an overlapping planner
       * holds, and cancellations with runs still to withdraw), marks those
       * no automation takes processed, and plans
       * units for the rest, owning their events by compare-and-set. Unit
       * keys include the planner instant, so events a dropped unit released
       * are planned again under a new key.
       */
      const planEvents = (at: Temporal.Instant) =>
        db.transaction((tx) =>
          Effect.Do.pipe(
            Effect.bind("events", () =>
              tx
                .select(intakeEventColumns)
                .from(customerEvents)
                .where(
                  and(
                    isNull(customerEvents.automationProcessedAt),
                    isNull(customerEvents.automationUnitId),
                    // A late planner leaves events after its tick's instant
                    // to the next tick, so no run's waits count from a tick
                    // before its event, as in the dry run (D36).
                    lte(
                      customerEvents.occurredAt,
                      automationTickAtOrBefore(at)
                    ),
                    or(
                      ne(customerEvents.kind, "reservation-cancelled"),
                      notExists(
                        tx
                          .select({ id: runs.id })
                          .from(runs)
                          .where(withdrawableRuns)
                      )
                    )
                  )
                )
                .orderBy(asc(customerEvents.recordedAt), asc(customerEvents.id))
                .limit(intakeBatchSize)
                .for("update", { skipLocked: true })
            ),
            Effect.bind("matches", ({ events }) =>
              matchIntakeEvents(tx, events)
            ),
            Effect.let("unmatched", ({ events, matches }) => {
              const matched = new Set(matches.map(({ event }) => event.id));
              return events
                .filter(({ id }) => !matched.has(id))
                .map(({ id }) => id);
            }),
            Effect.tap(({ unmatched }) =>
              tx
                .update(customerEvents)
                .set({ automationProcessedAt: at })
                .where(inArray(customerEvents.id, unmatched))
                .pipe(Effect.when(Effect.succeed(unmatched.length > 0)))
            ),
            Effect.bind("units", ({ matches }) =>
              matches.length === 0
                ? Effect.succeed([])
                : gateReads(tx, matches, at).pipe(
                    Effect.flatMap((reads) => pack(matches, reads))
                  )
            ),
            Effect.let(
              "eventIdsByKey",
              ({ units }) =>
                new Map(
                  units.map((unit) => [
                    plannedIntakeUnit(unit, at).key,
                    unit.eventIds,
                  ])
                )
            ),
            Effect.bind("planned", ({ units }) =>
              planAutomationUnits(
                tx,
                units.map((unit) => plannedIntakeUnit(unit, at)),
                at
              )
            ),
            Effect.tap(({ eventIdsByKey, planned }) =>
              Effect.forEach(
                planned.written,
                ({ unitId, key }) =>
                  tx
                    .update(customerEvents)
                    .set({ automationUnitId: unitId })
                    .where(
                      and(
                        inArray(
                          customerEvents.id,
                          eventIdsByKey.get(key) ?? []
                        ),
                        isNull(customerEvents.automationUnitId),
                        isNull(customerEvents.automationProcessedAt)
                      )
                    ),
                { discard: true }
              )
            ),
            Effect.map(({ events, unmatched, planned }) => ({
              eventsMatched: events.length - unmatched.length,
              eventsProcessed: unmatched.length,
              unitsPlanned: planned.written.length,
            }))
          )
        );

      return {
        plan: (at) =>
          Effect.Do.pipe(
            Effect.bind("withdrawnRuns", () => withdraw(at)),
            Effect.bind("events", () => planEvents(at)),
            Effect.map(
              ({ withdrawnRuns, events }): AutomationIntakePlan => ({
                withdrawnRuns,
                ...events,
              })
            ),
            Effect.withSpan("AutomationIntakePlanning.plan")
          ),
      } satisfies IAutomationIntakePlanning;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, AutomationEvaluationFacts.Live)
    )
  );
}
