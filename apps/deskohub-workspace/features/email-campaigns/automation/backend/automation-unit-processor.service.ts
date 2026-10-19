import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Data, Duration, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { emailCampaignAutomationWorkUnits as units } from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { currentInstant } from "@/shared/utils/temporal";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  type AutomationEngineTransaction,
  type AutomationUnitCommit,
  AutomationUnitDefect,
  type AutomationUnitExpiry,
  type ClaimedAutomationUnit,
  type RegisteredAutomationUnitHandler,
} from "./automation-unit-handler";
import { AutomationUnitHandlers } from "./automation-unit-handlers.service";
import { planAutomationUnits } from "./automation-unit-planning";
import { AutomationUnitQueue } from "./automation-unit-queue.service";
import { AutomationUnitSlots } from "./automation-unit-slots";

/**
 * The claim outlives the consumer's `maxDuration` (300 s), so a live
 * consumer is never superseded; the reaper takes over only from a dead one.
 */
const claimDuration = { seconds: 330 } as const;

/** Leaves room inside `maxDuration` for the commit after the fetch. */
const unitDeadline = Duration.seconds(270);

/**
 * The unit went back to `enqueued`, keeping its slot. The consumer fails so
 * the queue redelivers the message; there is no other retry loop.
 */
class AutomationUnitRedelivery extends Data.TaggedError(
  "AutomationUnitRedelivery"
)<{
  readonly unitId: AutomationWorkUnitId;
  readonly code: string;
  readonly cause?: unknown;
}> {}

/** A rejected commit: the unit was marked or its claim was taken over meanwhile. */
class AutomationUnitClaimLost extends Data.TaggedError(
  "AutomationUnitClaimLost"
) {}

/**
 * What a delivery did. `acknowledged` covers a settled unit, a duplicate
 * delivery against a live claim, an unsupported kind and a lost claim.
 */
export type AutomationUnitOutcome =
  | "acknowledged"
  | "done"
  | "dropped"
  | "failed";

interface IAutomationUnitProcessor {
  readonly process: (
    unitId: AutomationWorkUnitId
  ) => Effect.Effect<AutomationUnitOutcome, AutomationUnitRedelivery>;
}

type ClaimedUnit = ClaimedAutomationUnit<unknown> & {
  readonly claimId: string;
  readonly cancelRequestedAt: Temporal.Instant | null;
};

export class AutomationUnitProcessor extends Context.Service<
  AutomationUnitProcessor,
  IAutomationUnitProcessor
>()("@deskohub-workspace/email-campaigns/AutomationUnitProcessor") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const { byKind, supportedKinds } = yield* AutomationUnitHandlers;
      const slots = yield* AutomationUnitSlots;

      const claim = Effect.fn("automationUnit.claim")(function* (
        unitId: AutomationWorkUnitId
      ) {
        const claimId = yield* Effect.sync(() => crypto.randomUUID());
        const at = yield* currentInstant;
        const [unit] = yield* db
          .update(units)
          .set({
            status: "claimed",
            claimId,
            claimExpiresAt: at.add(claimDuration),
            attempts: sql`${units.attempts} + 1`,
            firstAttemptAt: sql`coalesce(${units.firstAttemptAt}, ${at.toString({ smallestUnit: "microsecond" })}::timestamptz)`,
          })
          .where(
            and(
              eq(units.id, unitId),
              eq(units.status, "enqueued"),
              inArray(units.kind, supportedKinds)
            )
          )
          .returning({
            id: units.id,
            kind: units.kind,
            key: units.key,
            campaignId: units.campaignId,
            subject: units.subject,
            requestCost: units.requestCost,
            attempt: units.attempts,
            deadlineMisses: units.deadlineMisses,
            cancelRequestedAt: units.cancelRequestedAt,
          });
        const kind = supportedKinds.find(
          (supported) => supported === unit?.kind
        );
        return unit === undefined || kind === undefined
          ? undefined
          : ({ ...unit, kind, claimId } satisfies ClaimedUnit);
      });

      /** Settles a unit the caller still claims, handing off its slot. */
      const settle = (
        unit: ClaimedUnit,
        settlement:
          | { readonly status: "failed"; readonly code: string }
          | { readonly status: "dropped" }
      ): Effect.Effect<AutomationUnitOutcome, AutomationUnitRedelivery> =>
        slots
          .handOff((tx, at) =>
            settleClaimed(
              tx,
              unit,
              settlement.status,
              at,
              "code" in settlement ? settlement.code : undefined
            )
          )
          .pipe(
            Effect.map((settled) =>
              settled ? settlement.status : ("acknowledged" as const)
            ),
            Effect.mapError(
              (cause) =>
                new AutomationUnitRedelivery({
                  unitId: unit.id,
                  code: "database",
                  cause,
                })
            )
          );

      /**
       * Returns the unit to `enqueued`, keeping its slot, and fails so the
       * queue redelivers. A unit marked meanwhile settles `dropped` instead.
       */
      const requeue = (
        unit: ClaimedUnit,
        failure: {
          readonly code: string;
          readonly deadlineMissed: boolean;
          readonly cause?: unknown;
        }
      ): Effect.Effect<AutomationUnitOutcome, AutomationUnitRedelivery> =>
        slots
          .handOff((tx, at) =>
            tx
              .update(units)
              .set({
                status: "enqueued",
                claimId: null,
                claimExpiresAt: null,
                enqueuedAt: at,
                lastErrorCode: failure.code,
                ...(failure.deadlineMissed && {
                  deadlineMisses: sql`${units.deadlineMisses} + 1`,
                }),
              })
              .where(
                and(
                  eq(units.id, unit.id),
                  eq(units.claimId, unit.claimId),
                  isNull(units.cancelRequestedAt)
                )
              )
              .returning({ id: units.id })
              .pipe(
                Effect.flatMap(([requeued]) =>
                  requeued === undefined
                    ? settleClaimed(tx, unit, "dropped", at).pipe(
                        Effect.map((dropped) =>
                          dropped ? ("dropped" as const) : "acknowledged"
                        )
                      )
                    : Effect.succeed("requeued" as const)
                )
              )
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new AutomationUnitRedelivery({
                  unitId: unit.id,
                  code: "database",
                  cause,
                })
            ),
            Effect.flatMap((outcome) =>
              outcome === "requeued"
                ? Effect.fail(
                    new AutomationUnitRedelivery({
                      unitId: unit.id,
                      code: failure.code,
                      cause: failure.cause,
                    })
                  )
                : Effect.succeed(outcome)
            )
          );

      /**
       * One transaction: the handler's domain writes, the done CAS on the
       * unit row, the follow-up units, then the slot hand-off (§5.4). A
       * rejected CAS rolls the handler's writes back.
       */
      const commit = (unit: ClaimedUnit, commitUnit: AutomationUnitCommit) =>
        slots
          .handOff((tx, at) =>
            commitUnit(tx, at).pipe(
              Effect.tap(() =>
                settleClaimed(tx, unit, "done", at).pipe(
                  Effect.filterOrFail(
                    (settled) => settled,
                    () => new AutomationUnitClaimLost()
                  )
                )
              ),
              Effect.flatMap((followUps) =>
                planAutomationUnits(tx, followUps, at)
              )
            )
          )
          .pipe(
            Effect.as<AutomationUnitOutcome>("done"),
            Effect.catchTags({
              // Marked meanwhile: settle `dropped`. Taken over: write nothing.
              AutomationUnitClaimLost: () =>
                settle(unit, { status: "dropped" }),
              AutomationUnitDefect: (defect) =>
                settle(unit, { status: "failed", code: defect.code }),
            }),
            Effect.catchIf(isDatabaseQueryError, (cause) =>
              requeue(unit, { code: "database", deadlineMissed: false, cause })
            )
          );

      /**
       * §5.2 step 2: the handler settles subjects past their limit in a
       * transaction that commits only while this claim holds and the unit
       * is unmarked (the unit row locks last, §5.4).
       */
      const expire = (
        unit: ClaimedUnit,
        { expire: expireSubjects }: RegisteredAutomationUnitHandler
      ) =>
        expireSubjects === undefined
          ? Effect.succeed<AutomationUnitExpiry>("remaining")
          : Effect.flatMap(currentInstant, (at) =>
              db.transaction((tx) =>
                expireSubjects(tx, unit, at).pipe(
                  Effect.tap(() =>
                    tx
                      .select({ id: units.id })
                      .from(units)
                      .where(
                        and(
                          eq(units.id, unit.id),
                          eq(units.claimId, unit.claimId),
                          isNull(units.cancelRequestedAt)
                        )
                      )
                      .for("update")
                      .pipe(
                        Effect.filterOrFail(
                          (held) => held.length > 0,
                          () => new AutomationUnitClaimLost()
                        )
                      )
                  )
                )
              )
            );

      const fetchAndCommit = (
        unit: ClaimedUnit,
        handler: RegisteredAutomationUnitHandler
      ) =>
        handler.fetch(unit).pipe(
          Effect.timeout(unitDeadline),
          Effect.flatMap((commitUnit) => commit(unit, commitUnit))
        );

      const run = (unit: ClaimedUnit) =>
        Effect.fromNullishOr(byKind.get(unit.kind)).pipe(
          Effect.mapError(
            () => new AutomationUnitDefect({ code: "kind-unsupported" })
          ),
          Effect.flatMap((handler) =>
            expire(unit, handler).pipe(
              Effect.flatMap((expiry) =>
                expiry === "settled"
                  ? commit(unit, () => Effect.succeed([]))
                  : fetchAndCommit(unit, handler)
              )
            )
          ),
          Effect.catchTags({
            // Marked meanwhile: settle `dropped`. Taken over: write nothing.
            AutomationUnitClaimLost: () => settle(unit, { status: "dropped" }),
            AutomationUnitFetchFailure: (failure) =>
              requeue(unit, {
                code: failure.code,
                deadlineMissed: false,
                cause: failure.cause,
              }),
            TimeoutError: () =>
              requeue(unit, { code: "deadline", deadlineMissed: true }),
            AutomationUnitDefect: (defect) =>
              settle(unit, { status: "failed", code: defect.code }),
          }),
          Effect.catchIf(isDatabaseQueryError, (cause) =>
            requeue(unit, { code: "database", deadlineMissed: false, cause })
          )
        );

      return {
        process: Effect.fn("automationUnit.process")(function* (unitId) {
          yield* Effect.annotateCurrentSpan({ unitId });
          const unit = yield* claim(unitId).pipe(
            Effect.mapError(
              (cause) =>
                new AutomationUnitRedelivery({
                  unitId,
                  code: "database",
                  cause,
                })
            )
          );
          if (unit === undefined) return "acknowledged";

          yield* Effect.annotateCurrentSpan({
            kind: unit.kind,
            attempt: unit.attempt,
          });
          if (unit.cancelRequestedAt !== null) {
            return yield* settle(unit, { status: "dropped" });
          }
          return yield* run(unit);
        }),
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
        AutomationUnitQueue.Default
      )
    )
  );
}

const settlementMarkCondition = {
  done: isNull(units.cancelRequestedAt),
  dropped: isNotNull(units.cancelRequestedAt),
  failed: undefined,
};

/**
 * Settles a unit by CAS on the caller's claim. `dropped` also requires the
 * cancellation mark, and `done` its absence, so a unit marked during its
 * fetch never commits pre-pause decisions.
 */
const settleClaimed = (
  tx: AutomationEngineTransaction,
  unit: ClaimedUnit,
  status: "done" | "dropped" | "failed",
  at: Temporal.Instant,
  lastErrorCode?: string
) =>
  tx
    .update(units)
    .set({
      status,
      claimId: null,
      claimExpiresAt: null,
      settledAt: at,
      ...(lastErrorCode !== undefined && { lastErrorCode }),
      ...(status === "failed" && { failures: sql`${units.failures} + 1` }),
    })
    .where(
      and(
        eq(units.id, unit.id),
        eq(units.claimId, unit.claimId),
        settlementMarkCondition[status]
      )
    )
    .returning({ id: units.id })
    .pipe(Effect.map((settled) => settled.length > 0));
