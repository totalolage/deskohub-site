import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { emailCampaignAutomationWorkUnits as units } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import { WorkspaceLocks } from "@/db/workspace-locks";
import { currentInstant } from "@/shared/utils/temporal";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import type { AutomationWorkUnitKind } from "../automation-work-units";
import { AutomationUnitHandlers } from "./automation-unit-handlers.service";
import { AutomationUnitQueue } from "./automation-unit-queue.service";

/**
 * Units in flight (`enqueued` or `claimed`) at once. Requests inside a unit
 * are sequential, so `total` bounds open Dotypos requests, and `deliver`
 * bounds open Resend batch requests.
 */
export const AutomationUnitSlotLimits =
  Context.Reference<AutomationUnitSlotLimits>(
    "@deskohub-workspace/email-campaigns/AutomationUnitSlotLimits",
    {
      defaultValue: () => ({ total: 4, deliver: 1 }),
    }
  );

type AutomationUnitSlotLimits = {
  readonly total: number;
  readonly deliver: number;
};

/** A unit promoted to `enqueued` whose message goes out after commit. */
export type EnqueuedAutomationUnit = {
  readonly unitId: AutomationWorkUnitId;
  readonly enqueueGeneration: number;
};

interface IAutomationUnitSlots {
  /**
   * Runs `write` in one transaction that ends with the slot hand-off, so a
   * slot a settling unit frees is reused at once, then publishes the units
   * it promoted. `at` is sampled when the transaction starts.
   */
  readonly handOff: <A, E>(
    write: (at: Temporal.Instant) => Effect.Effect<A, E, WorkspaceTransaction>
  ) => Effect.Effect<A, E | DatabaseQueryError>;
  /** Fills every free slot and returns the units it promoted. */
  readonly topUp: Effect.Effect<
    ReadonlyArray<EnqueuedAutomationUnit>,
    DatabaseQueryError
  >;
  /**
   * Publishes units already `enqueued`. A lost message only delays its unit,
   * because the reaper re-sends it, so a failure is logged, not raised.
   */
  readonly publish: (
    units: ReadonlyArray<EnqueuedAutomationUnit>
  ) => Effect.Effect<void>;
}

export class AutomationUnitSlots extends Context.Service<
  AutomationUnitSlots,
  IAutomationUnitSlots
>()("@deskohub-workspace/email-campaigns/AutomationUnitSlots") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { transaction } = yield* WorkspaceDatabase;
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
      const { supportedKinds } = yield* AutomationUnitHandlers;
      const queue = yield* AutomationUnitQueue;
      const limits = yield* AutomationUnitSlotLimits;

      const publish = (promoted: ReadonlyArray<EnqueuedAutomationUnit>) =>
        queue.enqueue(promoted).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Automation units could not be enqueued", {
              cause,
              unitIds: promoted.map((unit) => unit.unitId),
            })
          )
        );

      const transactWithHandOff = <A, E>(
        write: (
          at: Temporal.Instant
        ) => Effect.Effect<A, E, WorkspaceTransaction>
      ) =>
        currentInstant.pipe(
          Effect.flatMap((at) =>
            advisoryLock.withTransactionPermit(
              transaction(
                write(at).pipe(
                  Effect.flatMap((result) =>
                    fillAutomationUnitSlots({
                      supportedKinds,
                      limits,
                      at,
                    }).pipe(Effect.map((promoted) => ({ result, promoted })))
                  )
                )
              )
            )
          ),
          Effect.tap(({ promoted }) => publish(promoted))
        );

      return {
        handOff: (write) =>
          transactWithHandOff(write).pipe(
            Effect.map(({ result }) => result),
            Effect.withSpan("automationUnitSlots.handOff")
          ),
        topUp: transactWithHandOff(() => Effect.void).pipe(
          Effect.map(({ promoted }) => promoted),
          Effect.withSpan("automationUnitSlots.topUp")
        ),
        publish,
      };
    })
  );
}

const inFlightStatuses = ["enqueued", "claimed"] as const;

/**
 * Promotes `planned` units of the supported kinds into free slots: by
 * priority, then the automation with the fewest units in flight, then age.
 * The slot count changes only under the slot lock, taken last in the
 * transaction (§5.4), so concurrent hand-offs never exceed the limits.
 * Units of kinds this deployment doesn't run still hold their slots.
 *
 * A transaction can hold `planned` rows when it asks for the slot lock: a
 * hand-off that drops a preview's planned units, or re-plans a unit key, locks
 * them first. Promotion therefore never waits for a row; it skips one another
 * transaction holds, which a later hand-off or top-up promotes, so no wait
 * cycle forms with the slot lock.
 */
const fillAutomationUnitSlots = Effect.fn("automationUnitSlots.fill")(
  function* (input: {
    readonly supportedKinds: ReadonlyArray<AutomationWorkUnitKind>;
    readonly limits: AutomationUnitSlotLimits;
    readonly at: Temporal.Instant;
  }) {
    const { db } = yield* WorkspaceTransaction;
    const { limits } = input;
    yield* WorkspaceLocks.automationUnitSlots();

    const inFlight = yield* db
      .select({ kind: units.kind })
      .from(units)
      .where(inArray(units.status, inFlightStatuses));
    let total = inFlight.length;
    let deliver = inFlight.filter((unit) => unit.kind === "deliver").length;

    const promoted: Array<EnqueuedAutomationUnit> = [];
    while (total < limits.total) {
      const next = yield* nextPlannedUnit({
        supportedKinds: input.supportedKinds,
        deliverAllowed: deliver < limits.deliver,
      });
      if (next === undefined) break;

      const [unit] = yield* db
        .update(units)
        .set({ status: "enqueued", enqueuedAt: input.at })
        .where(and(eq(units.id, next.id), eq(units.status, "planned")))
        .returning({
          unitId: units.id,
          enqueueGeneration: units.enqueueGeneration,
        });
      if (unit === undefined) continue;

      promoted.push(unit);
      total += 1;
      if (next.kind === "deliver") deliver += 1;
    }

    return promoted;
  }
);

const inFlightOfCampaign = alias(units, "in_flight_of_campaign");

const nextPlannedUnit = (input: {
  readonly supportedKinds: ReadonlyArray<AutomationWorkUnitKind>;
  readonly deliverAllowed: boolean;
}) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ id: units.id, kind: units.kind })
      .from(units)
      .where(
        and(
          eq(units.status, "planned"),
          inArray(units.kind, input.supportedKinds),
          input.deliverAllowed ? undefined : ne(units.kind, "deliver")
        )
      )
      .orderBy(
        asc(units.priority),
        sql`(select count(*) from ${units} as ${sql.identifier("in_flight_of_campaign")} where ${inArray(
          inFlightOfCampaign.status,
          inFlightStatuses
        )} and ${inFlightOfCampaign.campaignId} is not distinct from ${units.campaignId})`,
        asc(units.createdAt),
        asc(units.id)
      )
      .limit(1)
      .for("update", { skipLocked: true })
      .pipe(Effect.map(([unit]) => unit))
  );
