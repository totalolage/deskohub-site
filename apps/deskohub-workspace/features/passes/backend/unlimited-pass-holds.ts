import "server-only";

import { type DotyposReservation, DotyposService } from "@deskohub/dotypos";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { Data, Effect, Array as EffectArray, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  type passPurchases,
  unlimitedPassDayMoves,
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import type { OrderId } from "@/features/order";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { currentInstant, type PlainDate } from "@/shared/utils/temporal";
import {
  ambiguousPassDayHoldCode,
  rejectedPassDayHoldCode,
} from "../pass-day-marker";
import { type PassTier, unlimitedPassDays } from "../pass-offer";
import { hasUnlimitedPassFirstDayEnded } from "./entry-pack-settlement";
import { recordAmbiguousPassDayHolds } from "./pass-day-hold-ownership";
import {
  createUnlimitedPassDayHold,
  listUnlimitedPassDayHolds,
  matchesUnlimitedPassDayHold,
  setUnlimitedPassDayHoldStatus,
} from "./unlimited-pass-dotypos-holds";

export class UnlimitedPassHoldsUnavailable extends Data.TaggedError(
  "UnlimitedPassHoldsUnavailable"
)<{
  readonly reason: "expired" | "unfinished" | "changed";
  readonly blockingDates?: readonly PlainDate[];
}> {}

type PassDay = WorkspaceReservationRow & {
  readonly serviceDate: NonNullable<WorkspaceReservationRow["serviceDate"]>;
  readonly passDayTableId: NonNullable<
    WorkspaceReservationRow["passDayTableId"]
  >;
};

export const readUnlimitedPassDays = Effect.fn("readUnlimitedPassDays")(
  function* (orderId: OrderId) {
    const { db } = yield* WorkspaceDatabase;
    const rows = yield* db
      .select()
      .from(workspaceReservations)
      .where(eq(workspaceReservations.passId, orderId))
      .orderBy(asc(workspaceReservations.serviceDate));
    return rows.filter(
      (row): row is PassDay =>
        row.serviceDate !== null && row.passDayTableId !== null
    );
  }
);

type Purchase = typeof passPurchases.$inferSelect;

const providerDay = (row: PassDay, tier: PassTier) => ({
  serviceDate: Temporal.PlainDate.from(row.serviceDate),
  tableId: row.passDayTableId,
  interval: getCoworkReservationInterval(
    tier === "open-space" ? tier : "reserved-desk",
    row.serviceDate
  ),
});

const passDayHold = (
  purchase: Pick<Purchase, "id" | "tier">,
  row: PassDay
) => ({
  passId: purchase.id,
  customerId: row.dotyposCustomerId,
  day: providerDay(row, purchase.tier),
  generation: row.passDayHoldGeneration,
});

const matchesPassDayAttempt = (row: PassDay) =>
  and(
    eq(workspaceReservations.id, row.id),
    eq(workspaceReservations.reservationState, row.reservationState),
    row.passDayHoldGeneration === null
      ? isNull(workspaceReservations.passDayHoldGeneration)
      : eq(
          workspaceReservations.passDayHoldGeneration,
          row.passDayHoldGeneration
        ),
    row.passDayHoldRequestedAt === null
      ? isNull(workspaceReservations.passDayHoldRequestedAt)
      : eq(
          workspaceReservations.passDayHoldRequestedAt,
          row.passDayHoldRequestedAt
        ),
    row.dotyposReservationId === null
      ? isNull(workspaceReservations.dotyposReservationId)
      : eq(
          workspaceReservations.dotyposReservationId,
          row.dotyposReservationId
        ),
    row.failureCode === null
      ? isNull(workspaceReservations.failureCode)
      : eq(workspaceReservations.failureCode, row.failureCode)
  );

const findUnboundPassDayHolds = (
  records: readonly DotyposReservation[],
  hold: ReturnType<typeof passDayHold>
) =>
  EffectArray.dedupeWith(
    records.filter(
      (record) =>
        // A legacy marker cannot associate a cancelled record with this attempt.
        (hold.generation !== null || record.status !== "CANCELLED") &&
        matchesUnlimitedPassDayHold(record, hold)
    ),
    (left, right) => left.id === right.id
  );

/** Check the issued day rows again in the payment admission transaction. */
export const readPayableUnlimitedHolds = Effect.fn("readPayableUnlimitedHolds")(
  function* (
    purchase: Pick<Purchase, "id" | "status" | "validFrom" | "holdsExpireAt">
  ) {
    const rows = yield* readUnlimitedPassDays(purchase.id);
    const now = yield* currentInstant;
    if (
      !purchase.holdsExpireAt ||
      Temporal.Instant.compare(now, purchase.holdsExpireAt) >= 0
    ) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "expired" });
    }
    if (purchase.status !== "pending_payment") {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "changed" });
    }
    const expiredDates = rows.flatMap((row) =>
      row.reservationHoldExpiresAt &&
      Temporal.Instant.compare(now, row.reservationHoldExpiresAt) >= 0
        ? [row.serviceDate]
        : []
    );
    if (expiredDates.length > 0) {
      return yield* new UnlimitedPassHoldsUnavailable({
        reason: "expired",
        blockingDates: expiredDates,
      });
    }
    const start = Temporal.PlainDate.from(purchase.validFrom);
    const holds = rows.flatMap((row, index) =>
      row.reservationState === "held" &&
      row.serviceDate === start.add({ days: index }).toString() &&
      row.dotyposReservationId &&
      row.reservationHoldExpiresAt
        ? [{ ...row, dotyposReservationId: row.dotyposReservationId }]
        : []
    );
    if (rows.length !== unlimitedPassDays || holds.length !== rows.length) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "unfinished" });
    }
    return holds;
  }
);

/** Provider confirmation happens before sending a payment request. */
export const reconfirmUnlimitedPassHolds = Effect.fn(
  "reconfirmUnlimitedPassHolds"
)(function* (
  purchase: Pick<
    Purchase,
    "id" | "status" | "validFrom" | "holdsExpireAt" | "tier"
  >
) {
  if (hasUnlimitedPassFirstDayEnded(purchase, yield* currentInstant)) {
    return yield* new UnlimitedPassHoldsUnavailable({ reason: "changed" });
  }
  const holds = yield* readPayableUnlimitedHolds(purchase);
  const dotypos = yield* DotyposService;
  const lookup = yield* dotypos
    .getReservationsByIds(
      holds.map((hold) => hold.dotyposReservationId),
      { concurrency: 1 }
    )
    .pipe(Effect.result);
  if (hasUnlimitedPassFirstDayEnded(purchase, yield* currentInstant)) {
    return yield* new UnlimitedPassHoldsUnavailable({ reason: "changed" });
  }
  if (Result.isFailure(lookup)) return yield* lookup.failure;
  const provider = lookup.success;
  for (const hold of holds) {
    const reservation = provider.get(hold.dotyposReservationId);
    if (
      reservation &&
      (reservation.status !== "NEW" ||
        !matchesUnlimitedPassDayHold(reservation, passDayHold(purchase, hold)))
    ) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "changed" });
    }
  }
  if (holds.some((hold) => !provider.has(hold.dotyposReservationId))) {
    return yield* new UnlimitedPassHoldsUnavailable({ reason: "unfinished" });
  }
});

const observePassDayHolds = (purchase: Purchase, rows: readonly PassDay[]) =>
  Effect.uninterruptibleMask(
    Effect.fnUntraced(function* (restore) {
      const first = rows.find((day) => day.passDayHoldRequestedAt);
      const records = first
        ? yield* restore(
            listUnlimitedPassDayHolds({
              passId: purchase.id,
              customerId: first.dotyposCustomerId,
              startDate: Temporal.PlainDate.from(purchase.validFrom),
            })
          )
        : [];
      const observed = rows
        .filter(
          (row) => row.passDayHoldRequestedAt && !row.dotyposReservationId
        )
        .map((row) => ({
          row,
          matches: findUnboundPassDayHolds(records, passDayHold(purchase, row)),
        }));
      // Record the full lookup before expiry or a failed day can end the batch.
      const { db } = yield* WorkspaceDatabase;
      yield* recordAmbiguousPassDayHolds(
        db,
        observed.flatMap(({ row, matches }) =>
          row.passDayHoldRequestedAt && matches.length > 1
            ? [
                {
                  passId: purchase.id,
                  serviceDate: row.serviceDate,
                  holdGeneration: row.passDayHoldGeneration,
                  holdRequestedAt: row.passDayHoldRequestedAt,
                },
              ]
            : []
        )
      );
      return {
        records,
        matches: new Map(
          observed.map(({ row, matches }) => [row.id, matches] as const)
        ),
      };
    })
  );

/** Runs inside the pass-order section after the local intent transaction commits. */
export const attemptUnlimitedPassHolds = Effect.fn("attemptUnlimitedPassHolds")(
  function* (purchase: Purchase) {
    const { db } = yield* WorkspaceDatabase;
    const rows = yield* readUnlimitedPassDays(purchase.id);
    if (
      rows.length !== unlimitedPassDays ||
      purchase.status !== "pending_payment"
    ) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "unfinished" });
    }
    const { matches } = yield* observePassDayHolds(
      purchase,
      rows.filter(
        (row) =>
          !row.dotyposReservationId &&
          row.failureCode !== ambiguousPassDayHoldCode
      )
    );
    const attachHold = Effect.fnUntraced(function* (row: PassDay) {
      if (row.failureCode === ambiguousPassDayHoldCode) {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "unfinished",
        });
      }
      if (row.reservationState === "held" && row.dotyposReservationId) return;
      if (row.reservationState !== "creating_hold") {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "changed",
          blockingDates: [row.serviceDate],
        });
      }
      const now = yield* currentInstant;
      if (
        !row.reservationHoldExpiresAt ||
        Temporal.Instant.compare(now, row.reservationHoldExpiresAt) >= 0
      ) {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "expired",
          blockingDates: [row.serviceDate],
        });
      }
      let attempt = row;
      let hold = passDayHold(purchase, attempt);
      let attached: DotyposReservation;
      if (row.passDayHoldRequestedAt) {
        const observed = matches.get(row.id);
        if (observed?.length !== 1 || !observed[0]) {
          return yield* new UnlimitedPassHoldsUnavailable({
            reason: "unfinished",
          });
        }
        attached = observed[0];
      } else {
        const generation = row.passDayHoldGeneration ?? crypto.randomUUID();
        const [claimed] = yield* db
          .update(workspaceReservations)
          .set({
            passDayHoldGeneration: generation,
            passDayHoldRequestedAt: now,
            updatedAt: now,
          })
          .where(matchesPassDayAttempt(row))
          .returning({ id: workspaceReservations.id });
        if (!claimed)
          return yield* new UnlimitedPassHoldsUnavailable({
            reason: "changed",
            blockingDates: [row.serviceDate],
          });
        attempt = {
          ...row,
          passDayHoldGeneration: generation,
          passDayHoldRequestedAt: now,
        };
        hold = passDayHold(purchase, attempt);
        attached = yield* createUnlimitedPassDayHold({
          ...hold,
          generation,
          coffee:
            purchase.tier !== "open-space" || purchase.unlimitedCoffee === true,
        }).pipe(
          Effect.tapError((error) =>
            error._tag === "DotyposUncertain"
              ? Effect.void
              : Effect.gen(function* () {
                  const failedAt = yield* currentInstant;
                  yield* db
                    .update(workspaceReservations)
                    .set({
                      failureCode: rejectedPassDayHoldCode,
                      reservationState: "hold_expired",
                      reservationHoldExpiredAt: failedAt,
                      updatedAt: failedAt,
                    })
                    .where(matchesPassDayAttempt(attempt));
                })
          )
        );
      }
      if (
        attached.status !== "NEW" ||
        !matchesUnlimitedPassDayHold(attached, hold)
      ) {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "changed",
          blockingDates: [row.serviceDate],
        });
      }
      const [saved] = yield* db
        .update(workspaceReservations)
        .set({
          dotyposReservationId: attached.id,
          reservationState: "held",
          reservationCreatedAt: now,
          updatedAt: now,
        })
        .where(matchesPassDayAttempt(attempt))
        .returning({ id: workspaceReservations.id });
      if (!saved) {
        return yield* new UnlimitedPassHoldsUnavailable({
          reason: "changed",
          blockingDates: [row.serviceDate],
        });
      }
    });
    for (const pair of EffectArray.chunksOf(rows, 2)) {
      const outcomes = yield* Effect.forEach(
        pair,
        (row) => Effect.result(attachHold(row)),
        { concurrency: 2 }
      );
      const failure = outcomes.find(Result.isFailure);
      if (!failure) continue;
      return {
        failure: failure.failure,
        blockingDates: outcomes.flatMap((outcome) =>
          Result.isFailure(outcome) &&
          outcome.failure._tag === "UnlimitedPassHoldsUnavailable"
            ? (outcome.failure.blockingDates ?? [])
            : []
        ),
      };
    }
    yield* readPayableUnlimitedHolds(purchase);
  },
  Effect.result,
  Effect.map((result) =>
    Result.isSuccess(result)
      ? result.success
      : { failure: result.failure, blockingDates: [] }
  )
);

export const createUnlimitedPassHolds = Effect.fn("createUnlimitedPassHolds")(
  function* (purchase: Purchase) {
    const attempt = yield* attemptUnlimitedPassHolds(purchase);
    if (attempt) return yield* attempt.failure;
  }
);

/** Under the pass fulfillment section, keeps uncertain POST claims allocated until observed. */
export const releaseUnlimitedPassDays = Effect.fn("releaseUnlimitedPassDays")(
  function* (purchase: Purchase) {
    if (
      (purchase.status === "withdrawn" || purchase.status === "cancelled") &&
      !purchase.accessEndsOn
    ) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "changed" });
    }
    const { db } = yield* WorkspaceDatabase;
    const dotypos = yield* DotyposService;
    const rows = (yield* readUnlimitedPassDays(purchase.id)).filter(
      (day) =>
        day.reservationState !== "cancelled" &&
        day.reservationState !== "hold_expired" &&
        day.failureCode !== ambiguousPassDayHoldCode &&
        (!purchase.accessEndsOn || day.serviceDate >= purchase.accessEndsOn)
    );
    const lookup = yield* Effect.result(observePassDayHolds(purchase, rows));
    const provider = Result.isSuccess(lookup) ? lookup.success : undefined;
    const attachedMoves = yield* db
      .select({
        reservationId: unlimitedPassDayMoves.reservationId,
        targetId: unlimitedPassDayMoves.targetReservationId,
        generation: unlimitedPassDayMoves.generation,
        customerId: unlimitedPassDayMoves.customerId,
        tableId: unlimitedPassDayMoves.targetTableId,
      })
      .from(unlimitedPassDayMoves)
      .innerJoin(
        workspaceReservations,
        eq(workspaceReservations.id, unlimitedPassDayMoves.reservationId)
      )
      .where(
        and(
          eq(workspaceReservations.passId, purchase.id),
          isNotNull(unlimitedPassDayMoves.attachedAt)
        )
      );
    const movesByTarget = new Map(
      attachedMoves.map((move) => [move.targetId, move])
    );
    yield* Effect.forEach(
      rows,
      Effect.fnUntraced(
        function* (row: PassDay) {
          const now = yield* currentInstant;
          let released = provider?.records.find(
            ({ id }) => id === row.dotyposReservationId
          );
          if (!row.dotyposReservationId && row.passDayHoldRequestedAt) {
            const observed = provider?.matches.get(row.id);
            if (observed?.length !== 1) return;
            released = observed[0];
          }
          const releasedId = row.dotyposReservationId ?? released?.id;
          if (!releasedId && row.passDayHoldRequestedAt) return;
          let attempt = row;
          if (releasedId) {
            // Fence provider cancellation and keep the id if the request is interrupted.
            const [claimed] = yield* db
              .update(workspaceReservations)
              .set({
                dotyposReservationId: releasedId,
                reservationState: "cancelling",
                updatedAt: now,
              })
              .where(matchesPassDayAttempt(row))
              .returning({ id: workspaceReservations.id });
            if (!claimed) return;
            attempt = {
              ...row,
              dotyposReservationId: releasedId,
              reservationState: "cancelling",
            };
            const move = movesByTarget.get(releasedId);
            if (move) {
              if (
                move.reservationId !== row.id ||
                move.generation !== row.passDayHoldGeneration ||
                move.customerId !== row.dotyposCustomerId ||
                move.tableId !== row.passDayTableId
              )
                return yield* new UnlimitedPassHoldsUnavailable({
                  reason: "changed",
                  blockingDates: [row.serviceDate],
                });
              yield* setUnlimitedPassDayHoldStatus(
                releasedId,
                passDayHold(purchase, row),
                "CANCELLED"
              ).pipe(
                Effect.catchTag("DotyposRejected", (error) =>
                  error.reason === "not-found"
                    ? Effect.void
                    : Effect.fail(error)
                )
              );
            } else if (released?.status !== "CANCELLED") {
              yield* dotypos.cancelReservation(releasedId);
            }
          }
          yield* db
            .update(workspaceReservations)
            .set({
              reservationState: releasedId ? "cancelled" : "hold_expired",
              ...(releasedId && {
                dotyposReservationId: releasedId,
                reservationCancelledAt: now,
              }),
              reservationHoldExpiredAt: now,
              updatedAt: now,
            })
            .where(matchesPassDayAttempt(attempt));
        },
        Effect.catch(() =>
          Effect.logWarning("Unlimited pass day release needs reconciliation")
        )
      ),
      { concurrency: 2, discard: true }
    );
    if (Result.isFailure(lookup)) return yield* lookup.failure;
  }
);

/** Confirms each stable day idempotently before the entitlement is activated. */
export const confirmUnlimitedPassDays = Effect.fn("confirmUnlimitedPassDays")(
  function* (purchase: Purchase) {
    const { db } = yield* WorkspaceDatabase;
    const dotypos = yield* DotyposService;
    const rows = yield* readUnlimitedPassDays(purchase.id);
    if (
      rows.length !== unlimitedPassDays ||
      rows.some((day) => day.paymentState !== "paid")
    ) {
      return yield* new UnlimitedPassHoldsUnavailable({ reason: "unfinished" });
    }
    yield* Effect.forEach(
      rows,
      Effect.fnUntraced(function* (row: PassDay) {
        if (
          row.reservationState === "confirmed" &&
          row.fulfillmentState === "fulfilled"
        )
          return;
        if (
          row.reservationState !== "confirming" ||
          !row.dotyposReservationId
        ) {
          return yield* new UnlimitedPassHoldsUnavailable({
            reason: "unfinished",
          });
        }
        const confirmed = yield* dotypos.confirmReservation(
          row.dotyposReservationId
        );
        if (
          confirmed.status !== "CONFIRMED" ||
          !matchesUnlimitedPassDayHold(confirmed, passDayHold(purchase, row))
        ) {
          return yield* new UnlimitedPassHoldsUnavailable({
            reason: "changed",
          });
        }
        const now = yield* currentInstant;
        yield* db
          .update(workspaceReservations)
          .set({
            reservationState: "confirmed",
            fulfillmentState: "fulfilled",
            reservationConfirmedAt: now,
            fulfilledAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(workspaceReservations.id, row.id),
              eq(workspaceReservations.reservationState, "confirming"),
              eq(
                workspaceReservations.dotyposReservationId,
                row.dotyposReservationId
              )
            )
          );
      }),
      { concurrency: 2, discard: true }
    );
  }
);
