import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Context, Data, Duration, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase, WorkspaceTransaction } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { emailCampaignAutomationWorkUnits as units } from "@/db/schema";
import { isDatabaseQueryError } from "@/db/sql-constraint";
import { currentInstant } from "@/shared/utils/temporal";
import type { CampaignSendId } from "../../campaign-identifiers";
import type { AutomationWorkUnitId } from "../automation-identifiers";
import {
  AutomationUnitDefect,
  type AutomationUnitExpiry,
  type AutomationUnitSubmit,
  type ClaimedAutomationUnit,
  type FetchedAutomationUnit,
  type RegisteredAutomationUnitHandler,
} from "./automation-unit-handler";
import { AutomationUnitHandlers } from "./automation-unit-handlers.service";
import {
  planAutomationUnits,
  releaseAutomationUnitSubjects,
} from "./automation-unit-planning";
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
  /** Set once the unit's commit persisted a send (§5.9). */
  readonly sendId: CampaignSendId | null;
};

type PersistedUnit = ClaimedUnit & { readonly sendId: CampaignSendId };

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
            sendId: units.sendId,
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
          /** A failed lifecycle recheck drops the unit whether or not it is marked. */
          | { readonly status: "dropped"; readonly code: string }
      ): Effect.Effect<AutomationUnitOutcome, AutomationUnitRedelivery> =>
        slots
          .handOff((at) =>
            "code" in settlement
              ? settleClaimed(unit, settlement.status, at, {
                  lastErrorCode: settlement.code,
                  ignoreMark: true,
                })
              : settleClaimed(unit, settlement.status, at)
          )
          .pipe(
            Effect.as<AutomationUnitOutcome>(settlement.status),
            // Taken over meanwhile: the new claimant settles it.
            Effect.catchTag("AutomationUnitClaimLost", () =>
              Effect.succeed<AutomationUnitOutcome>("acknowledged")
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
       * queue redelivers. A unit marked meanwhile settles `dropped` instead,
       * unless it persisted a send: that unit is its send's only way to
       * settle, so it ignores the mark (§5.9).
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
          .handOff((at) =>
            db
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
                  unit.sendId === null
                    ? isNull(units.cancelRequestedAt)
                    : undefined
                )
              )
              .returning({ id: units.id })
              .pipe(
                Effect.flatMap(([requeued]) =>
                  requeued === undefined
                    ? missedRequeue(unit, at)
                    : Effect.succeed("requeued" as const)
                )
              )
          )
          .pipe(
            Effect.catchTag("AutomationUnitClaimLost", () =>
              Effect.succeed("acknowledged" as const)
            ),
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
       * §5.9: submits the send a unit persisted, then settles the unit
       * `done` in the transaction that settles the send, handing off its
       * slot only then. Every failure, a defect included, returns the unit
       * to `enqueued` whether or not it is marked, so a persisted send
       * always settles, once.
       */
      const submitPersisted = (
        unit: PersistedUnit,
        submit: AutomationUnitSubmit | undefined
      ): Effect.Effect<AutomationUnitOutcome, AutomationUnitRedelivery> =>
        Effect.fromNullishOr(submit).pipe(
          Effect.mapError(
            () => new AutomationUnitDefect({ code: "submit-unsupported" })
          ),
          Effect.flatMap((submitSend) => submitSend(unit)),
          Effect.timeout(unitDeadline),
          Effect.flatMap((settlement) =>
            slots.handOff((at) =>
              settlement(at).pipe(
                Effect.andThen(
                  settleClaimed(unit, "done", at, { ignoreMark: true })
                )
              )
            )
          ),
          Effect.as<AutomationUnitOutcome>("done"),
          Effect.catchTags({
            // Taken over meanwhile: the new claimant settles it.
            AutomationUnitClaimLost: () =>
              Effect.succeed<AutomationUnitOutcome>("acknowledged"),
            AutomationUnitFetchFailure: (failure) =>
              requeue(unit, {
                code: failure.code,
                deadlineMissed: false,
                cause: failure.cause,
              }),
            AutomationUnitDefect: (defect) =>
              requeue(unit, {
                code: defect.code,
                deadlineMissed: false,
                cause: defect.cause,
              }),
            TimeoutError: () =>
              requeue(unit, { code: "deadline", deadlineMissed: false }),
          }),
          Effect.catchIf(isDatabaseQueryError, (cause) =>
            requeue(unit, { code: "database", deadlineMissed: false, cause })
          )
        );

      /**
       * One transaction: the handler's domain writes, the done CAS on the
       * unit row, the follow-up units, then the slot hand-off (§5.4). A
       * rejected CAS rolls the handler's writes back. A commit that
       * persisted a send keeps the unit claimed instead and submits it.
       */
      const commit = (
        unit: ClaimedUnit,
        { commit: commitUnit, submit }: FetchedAutomationUnit
      ) =>
        slots
          .handOff((at) =>
            commitUnit(at).pipe(
              Effect.flatMap((followUps) =>
                holdOrSettle(unit, at).pipe(
                  Effect.tap(() => planAutomationUnits(followUps, at))
                )
              )
            )
          )
          .pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed<AutomationUnitOutcome>("done"),
                onSome: (sendId) =>
                  submitPersisted({ ...unit, sendId }, submit),
              })
            ),
            Effect.catchTags({
              // Marked meanwhile: settle `dropped`. Taken over: write nothing.
              AutomationUnitClaimLost: () =>
                settle(unit, { status: "dropped" }),
              AutomationUnitDefect: (defect) =>
                settle(unit, { status: "failed", code: defect.code }),
              AutomationUnitRecheckFailed: (recheck) =>
                settle(unit, { status: "dropped", code: recheck.code }),
            }),
            Effect.catchIf(isDatabaseQueryError, (cause) =>
              requeue(unit, { code: "database", deadlineMissed: false, cause })
            )
          );

      /**
       * §5.2 step 2: the handler settles subjects past their limit in a
       * transaction that commits only while this claim holds and the unit
       * is unmarked (the unit row locks last, §5.4). With nothing left to
       * fetch, the same transaction settles the unit `done` and hands off
       * its slot, so a redelivery never repeats an expiry that settled it.
       */
      const expire = (
        unit: ClaimedUnit,
        { expire: expireSubjects }: RegisteredAutomationUnitHandler
      ) =>
        expireSubjects === undefined
          ? Effect.succeed<AutomationUnitExpiry>("remaining")
          : slots.handOff((at) =>
              expireSubjects(unit, at).pipe(
                Effect.tap((expiry) =>
                  expiry === "settled"
                    ? settleClaimed(unit, "done", at)
                    : lockHeldClaim(unit)
                )
              )
            );

      const fetchAndCommit = (
        unit: ClaimedUnit,
        handler: RegisteredAutomationUnitHandler
      ) =>
        handler.fetch(unit).pipe(
          Effect.timeout(unitDeadline),
          Effect.flatMap((fetched) => commit(unit, fetched))
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
                  ? Effect.succeed<AutomationUnitOutcome>("done")
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
          // A persisted send settles whatever the unit's mark (§5.9).
          if (unit.sendId !== null) {
            return yield* submitPersisted(
              { ...unit, sendId: unit.sendId },
              byKind.get(unit.kind)?.submit
            );
          }
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
        AutomationUnitQueue.Live
      )
    )
  );
}

/**
 * A requeue CAS that missed: the unit was marked meanwhile and settles
 * `dropped`, unless it persisted a send, which ignores marks; then its claim
 * was taken over.
 */
const missedRequeue = (unit: ClaimedUnit, at: Temporal.Instant) =>
  unit.sendId === null
    ? settleClaimed(unit, "dropped", at).pipe(Effect.as("dropped" as const))
    : Effect.fail(new AutomationUnitClaimLost());

/**
 * Locks the unit row while the caller's claim holds and the unit is
 * unmarked, or fails with `AutomationUnitClaimLost`.
 */
const lockHeldClaim = (unit: ClaimedUnit) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
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
        ),
        Effect.asVoid
      )
  );

/**
 * Settles a committed unit `done` by CAS on the caller's claim, unless its
 * commit persisted a send (set `send_id`): then the unit stays claimed,
 * holding its slot until the send settles, and its send's id is returned.
 * Either way the claim must still hold and the unit be unmarked. Only this
 * transaction's commit sets `send_id`, so it reads without a lock: settling
 * frees the run rows before its CAS locks the unit row (§5.4).
 */
const holdOrSettle = (unit: ClaimedUnit, at: Temporal.Instant) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({ sendId: units.sendId })
      .from(units)
      .where(eq(units.id, unit.id))
      .pipe(
        Effect.map(([unitRow]) => Option.fromNullishOr(unitRow?.sendId)),
        Effect.tap(
          Option.match({
            onNone: () => settleClaimed(unit, "done", at),
            onSome: () => lockHeldClaim(unit),
          })
        )
      )
  );

const settlementMarkCondition = {
  done: isNull(units.cancelRequestedAt),
  dropped: isNotNull(units.cancelRequestedAt),
  failed: undefined,
};

/**
 * Settles a unit by CAS on the caller's claim, first freeing the subjects
 * it still owns. `dropped` also requires the cancellation mark, and `done`
 * its absence, so a unit marked during its fetch never commits pre-pause
 * decisions. A missed CAS fails with `AutomationUnitClaimLost`, rolling the
 * release back with the rest of the transaction.
 */
const settleClaimed = (
  unit: ClaimedUnit,
  status: "done" | "dropped" | "failed",
  at: Temporal.Instant,
  {
    lastErrorCode,
    ignoreMark = false,
  }: { readonly lastErrorCode?: string; readonly ignoreMark?: boolean } = {}
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    releaseAutomationUnitSubjects([unit]).pipe(
      Effect.andThen(
        db
          .update(units)
          .set({
            status,
            claimId: null,
            claimExpiresAt: null,
            settledAt: at,
            ...(lastErrorCode !== undefined && { lastErrorCode }),
            ...(status === "failed" && {
              failures: sql`${units.failures} + 1`,
            }),
          })
          .where(
            and(
              eq(units.id, unit.id),
              eq(units.claimId, unit.claimId),
              ignoreMark ? undefined : settlementMarkCondition[status]
            )
          )
          .returning({ id: units.id })
      ),
      Effect.filterOrFail(
        (settled) => settled.length > 0,
        () => new AutomationUnitClaimLost()
      ),
      Effect.asVoid
    )
  );
