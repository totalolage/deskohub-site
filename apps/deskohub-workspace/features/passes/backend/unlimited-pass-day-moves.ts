import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import {
  orders,
  passPurchases,
  unlimitedPassDayMoves,
  workspaceReservations,
} from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import {
  getOccupancyWindow,
  getOccupancyWindowDates,
  getTableBookingOccupancyById,
} from "@/features/checkout/backend/reservation/workspace-table-occupancy";
import {
  decodeTableSeatCapacity,
  hasCandidateCapacity,
  isWorkspaceCoworkTableCandidate,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import { currentInstant, plainDateStringSchema } from "@/shared/utils/temporal";
import { movablePassDay } from "./movable-pass-day";
import { getBookingsWithPassDayIntents } from "./pass-day-capacity-bookings";
import type { MovablePassDay, PassDayMovePlan } from "./pass-day-move-plan";
import {
  createUnlimitedPassDayHold,
  hasUnlimitedPassDayMarker,
  matchesUnlimitedPassDayHold,
  setUnlimitedPassDayHoldStatus,
} from "./unlimited-pass-dotypos-holds";

type Move = typeof unlimitedPassDayMoves.$inferSelect;
type MoveKey = Pick<MovablePassDay, "reservationId" | "passId" | "serviceDate">;

const stillPending = (move: Pick<Move, "generation">) =>
  and(
    eq(unlimitedPassDayMoves.generation, move.generation),
    isNull(unlimitedPassDayMoves.settledAt)
  );

const expectedHold = (key: MoveKey, move: Move, side: "source" | "target") => ({
  passId: key.passId,
  customerId: move.customerId,
  generation: side === "source" ? move.sourceGeneration : move.generation,
  day: {
    serviceDate: Temporal.PlainDate.from(key.serviceDate),
    tableId: side === "source" ? move.sourceTableId : move.targetTableId,
    interval: getCoworkReservationInterval("open-space", key.serviceDate),
  },
});

const makePassDayMoves = Effect.gen(function* () {
  const { db, transaction } = yield* WorkspaceDatabase;
  const dotypos = yield* DotyposService;
  const reservations = yield* WorkspaceReservationRepository;
  const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;

  const readSource = (
    key: MoveKey,
    sourceReservationId: DotyposReservationId,
    now: Temporal.Instant
  ) =>
    db
      .select({
        day: workspaceReservations,
        coffee: passPurchases.unlimitedCoffee,
      })
      .from(workspaceReservations)
      .innerJoin(
        passPurchases,
        eq(passPurchases.id, workspaceReservations.passId)
      )
      .innerJoin(orders, eq(orders.id, passPurchases.id))
      .where(
        and(
          eq(workspaceReservations.id, key.reservationId),
          eq(workspaceReservations.passId, key.passId),
          eq(workspaceReservations.serviceDate, key.serviceDate),
          gt(
            workspaceReservations.serviceDate,
            plainDateStringSchema.make(getWorkspaceDate(now).toString())
          ),
          eq(workspaceReservations.dotyposReservationId, sourceReservationId),
          movablePassDay
        )
      );

  const readRecord = (id: DotyposReservationId) =>
    dotypos
      .getReservationWithoutCustomer(id)
      .pipe(
        Effect.catchTag("DotyposRejected", (error) =>
          error.reason === "not-found"
            ? Effect.succeed(undefined)
            : Effect.fail(error)
        )
      );

  const markSettled = Effect.fnUntraced(function* (
    move: Pick<Move, "generation">
  ) {
    const now = yield* currentInstant;
    yield* db
      .update(unlimitedPassDayMoves)
      .set({ settledAt: now })
      .where(stillPending(move));
  });

  const markAmbiguous = Effect.fnUntraced(function* (
    move: Move,
    ambiguousReservationIds?: readonly DotyposReservationId[]
  ) {
    const now = yield* currentInstant;
    yield* db
      .update(unlimitedPassDayMoves)
      .set({
        ambiguousAt: now,
        ...(ambiguousReservationIds && {
          ambiguousReservationIds: [...ambiguousReservationIds],
        }),
      })
      .where(stillPending(move));
    yield* Effect.logWarning(
      "Unlimited pass day move provider ownership is uncertain"
    );
  });

  const setHoldStatus = (
    reservationId: DotyposReservationId,
    hold: ReturnType<typeof expectedHold>,
    status: "CONFIRMED" | "CANCELLED"
  ) =>
    setUnlimitedPassDayHoldStatus(reservationId, hold, status).pipe(
      Effect.provideService(DotyposService, dotypos)
    );

  const canReleaseSource = Effect.fnUntraced(function* (
    key: MoveKey,
    move: Move
  ) {
    if (!move.targetReservationId) return false;
    const [current] = yield* db
      .select({
        id: workspaceReservations.dotyposReservationId,
        customerId: workspaceReservations.dotyposCustomerId,
        tableId: workspaceReservations.passDayTableId,
        generation: workspaceReservations.passDayHoldGeneration,
        cutoff: passPurchases.accessEndsOn,
        status: passPurchases.status,
      })
      .from(workspaceReservations)
      .innerJoin(
        passPurchases,
        eq(passPurchases.id, workspaceReservations.passId)
      )
      .where(
        and(
          eq(workspaceReservations.id, key.reservationId),
          eq(workspaceReservations.passId, key.passId),
          eq(workspaceReservations.serviceDate, key.serviceDate)
        )
      );
    if (
      current?.id !== move.targetReservationId ||
      current.customerId !== move.customerId ||
      current.tableId !== move.targetTableId ||
      current.generation !== move.generation
    )
      return false;
    if (
      (current.status === "withdrawn" || current.status === "cancelled") &&
      current.cutoff &&
      key.serviceDate >= current.cutoff
    )
      return true;
    const replacement = yield* readRecord(move.targetReservationId);
    return (
      replacement?.status === "CONFIRMED" &&
      matchesUnlimitedPassDayHold(
        replacement,
        expectedHold(key, move, "target")
      )
    );
  });

  // Read by ID before DELETE, including after an uncertain reply. Only an
  // exact, still-active hold owned by this move is safe to cancel.
  const retireHold = Effect.fnUntraced(function* (
    key: MoveKey,
    move: Move,
    side: "source" | "target"
  ) {
    const id =
      side === "source" ? move.sourceReservationId : move.targetReservationId;
    if (!id) return false;
    if (side === "source" && !(yield* canReleaseSource(key, move)))
      return false;
    const record = yield* readRecord(id);
    if (record && record.status !== "CANCELLED") {
      const hold = expectedHold(key, move, side);
      if (!matchesUnlimitedPassDayHold(record, hold)) {
        yield* markAmbiguous(move);
        return false;
      }
      if (record.status === "NEW" || record.status === "CONFIRMED") {
        yield* setHoldStatus(id, hold, "CANCELLED");
        const released = yield* readRecord(id);
        if (released && released.status !== "CANCELLED") return false;
      } else {
        return false;
      }
    }
    yield* markSettled(move);
    return true;
  });

  // Only the initial owner sends a POST. A later run searches the full day
  // for that generation and never interprets an empty read as a failed POST.
  const findTarget = Effect.fnUntraced(function* (key: MoveKey, move: Move) {
    if (move.targetReservationId)
      return yield* readRecord(move.targetReservationId);
    const expected = expectedHold(key, move, "target");
    const { startDate, endDate } = getOccupancyWindowDates(
      getOccupancyWindow(expected.day.serviceDate)
    );
    const records = yield* dotypos.listReservations({
      customerId: move.customerId,
      startsAtOrAfter: startDate.toISOString(),
      startsBefore: endDate.toISOString(),
    });
    const marked = new Map(
      records
        .filter((record) =>
          hasUnlimitedPassDayMarker(
            record,
            key.passId,
            expected.day.serviceDate,
            move.generation
          )
        )
        .map((record) => [record.id, record])
    );
    if (marked.size > 1) {
      yield* markAmbiguous(move, [...marked.keys()]);
      return undefined;
    }
    return marked.values().next().value;
  });

  const targetCapacity = Effect.fnUntraced(function* (
    key: MoveKey,
    move: Move & { readonly targetReservationId: DotyposReservationId }
  ) {
    const { day } = expectedHold(key, move, "target");
    const claims = yield* reservations.selectPendingPassDayCapacity({
      first: day.serviceDate,
      last: day.serviceDate,
    });
    const window = getOccupancyWindow(day.interval);
    const { tables, records, expired } = yield* Effect.all({
      tables: dotypos.getTables(),
      records: dotypos.listActiveReservationsOverlapping(
        getOccupancyWindowDates(window)
      ),
      expired: reservations.selectExpiredHoldDotyposReservationIds({
        now: yield* currentInstant,
      }),
    });
    const ids = new Set([
      move.targetReservationId,
      ...records.flatMap((record) =>
        hasUnlimitedPassDayMarker(
          record,
          key.passId,
          day.serviceDate,
          move.generation
        )
          ? [record.id]
          : []
      ),
    ]);
    if (ids.size > 1) {
      yield* markAmbiguous(move, [...ids]);
      return "ambiguous" as const;
    }
    const table = tables.find(
      ({ id, enabled, display, tags }) =>
        id === move.targetTableId &&
        enabled === true &&
        display === true &&
        isWorkspaceCoworkTableCandidate(new Set(tags), {
          entryTier: "open-space",
        })
    );
    if (!table) return "taken" as const;
    const capacity = decodeTableSeatCapacity(table);
    if (Result.isFailure(capacity)) return "taken" as const;
    const excluded = new Set([...expired, move.targetReservationId]);
    const bookings = getBookingsWithPassDayIntents(
      records.filter(({ id }) => !excluded.has(id)),
      claims.filter(
        (claim) =>
          !(
            claim.moveClaim &&
            claim.passId === key.passId &&
            claim.holdGeneration === move.generation
          )
      )
    );
    return hasCandidateCapacity(
      [{ table, seatCapacity: capacity.success }],
      getTableBookingOccupancyById(bookings, window)
    )
      ? ("available" as const)
      : ("taken" as const);
  });

  const sameSource = (
    row: typeof workspaceReservations.$inferSelect,
    move: Move
  ) =>
    row.passDayTableId === move.sourceTableId &&
    row.dotyposCustomerId === move.customerId &&
    row.passDayHoldGeneration === move.sourceGeneration;

  const attachTarget = Effect.fnUntraced(function* (
    key: MoveKey,
    move: Move,
    id: DotyposReservationId
  ) {
    return yield* transaction(
      Effect.gen(function* () {
        // Withdrawal uses this same order-before-purchase row lock order.
        yield* db
          .select({ id: orders.id })
          .from(orders)
          .where(eq(orders.id, key.passId))
          .for("no key update");
        const [current] = yield* readSource(
          key,
          move.sourceReservationId,
          yield* currentInstant
        ).for("no key update", { of: [passPurchases, workspaceReservations] });
        const now = yield* currentInstant;
        if (
          !current ||
          !sameSource(current.day, move) ||
          key.serviceDate <= getWorkspaceDate(now).toString()
        )
          return false;

        yield* db
          .update(workspaceReservations)
          .set({
            dotyposReservationId: id,
            passDayTableId: move.targetTableId,
            passDayHoldGeneration: move.generation,
            passDayHoldRequestedAt: move.requestedAt,
            updatedAt: now,
          })
          .where(eq(workspaceReservations.id, key.reservationId));
        yield* db
          .update(unlimitedPassDayMoves)
          .set({ attachedAt: now })
          .where(stillPending(move));
        return true;
      })
    );
  });

  const continueMove = Effect.fnUntraced(function* (
    key: MoveKey,
    move: Move,
    created?: DotyposReservation
  ) {
    if (move.ambiguousAt) return false;
    if (move.attachedAt) return yield* retireHold(key, move, "source");
    const target = created ?? (yield* findTarget(key, move));
    if (!target) {
      if (move.targetReservationId) yield* markSettled(move);
      return false;
    }
    const targetHold = expectedHold(key, move, "target");
    if (
      target.id === move.sourceReservationId ||
      !matchesUnlimitedPassDayHold(target, targetHold)
    ) {
      yield* markAmbiguous(move);
      return false;
    }
    yield* db
      .update(unlimitedPassDayMoves)
      .set({ targetReservationId: target.id })
      .where(stillPending(move));
    const bound = { ...move, targetReservationId: target.id };
    if (target.status === "CANCELLED") {
      yield* markSettled(bound);
      return false;
    }
    if (target.status !== "NEW" && target.status !== "CONFIRMED") return false;

    const [current] = yield* readSource(
      key,
      move.sourceReservationId,
      yield* currentInstant
    );
    const source = yield* readRecord(move.sourceReservationId);
    const capacity = yield* targetCapacity(key, bound);
    if (capacity === "ambiguous") return false;
    if (
      !current ||
      !sameSource(current.day, move) ||
      source?.status !== "CONFIRMED" ||
      !matchesUnlimitedPassDayHold(source, expectedHold(key, move, "source")) ||
      capacity === "taken"
    ) {
      yield* retireHold(key, bound, "target");
      return false;
    }
    const confirmed =
      target.status === "CONFIRMED"
        ? target
        : yield* setHoldStatus(target.id, targetHold, "CONFIRMED");
    if (
      confirmed.status !== "CONFIRMED" ||
      !matchesUnlimitedPassDayHold(confirmed, targetHold)
    ) {
      yield* markAmbiguous(bound);
      return false;
    }
    if (!(yield* attachTarget(key, bound, target.id))) {
      yield* retireHold(key, bound, "target");
      return false;
    }
    return yield* retireHold(key, bound, "source");
  });

  const withPass =
    (passId: MoveKey["passId"]) =>
    <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        WorkspaceLockSections.passPurchaseFulfillment(passId),
        Effect.provideService(WorkspaceDatabaseAdvisoryLock, advisoryLock)
      );

  /** Caller holds the shared capacity lock for the full service date. */
  const movePassDay = Effect.fn("PassDayMoves.move")(function* ({
    source: key,
    targetTableId,
  }: PassDayMovePlan) {
    return yield* Effect.gen(function* () {
      const now = yield* currentInstant;
      const [current] = yield* readSource(key, key.sourceReservationId, now);
      if (
        !current ||
        current.day.passDayTableId !== key.booking.tableId ||
        targetTableId === current.day.passDayTableId
      )
        return false;

      const move: Move = {
        generation: crypto.randomUUID(),
        reservationId: key.reservationId,
        customerId: current.day.dotyposCustomerId,
        sourceReservationId: key.sourceReservationId,
        sourceTableId: current.day.passDayTableId,
        sourceGeneration: current.day.passDayHoldGeneration,
        targetTableId,
        requestedAt: now,
        checkedAt: now,
        targetReservationId: null,
        attachedAt: null,
        settledAt: null,
        ambiguousAt: null,
        ambiguousReservationIds: null,
      };
      const source = yield* readRecord(move.sourceReservationId);
      if (
        source?.status !== "CONFIRMED" ||
        !matchesUnlimitedPassDayHold(source, expectedHold(key, move, "source"))
      )
        return false;
      const [pending] = yield* db
        .insert(unlimitedPassDayMoves)
        .values(move)
        .onConflictDoNothing()
        .returning({ generation: unlimitedPassDayMoves.generation });
      if (!pending) return false;
      const { day } = expectedHold(key, move, "target");
      if (
        key.serviceDate <= getWorkspaceDate(yield* currentInstant).toString()
      ) {
        yield* markSettled(pending);
        return false;
      }
      const created = yield* Effect.uninterruptibleMask((restore) =>
        restore(
          createUnlimitedPassDayHold({
            passId: key.passId,
            customerId: move.customerId,
            day,
            generation: move.generation,
            coffee: current.coffee === true,
            singleAttempt: true,
          }).pipe(Effect.provideService(DotyposService, dotypos))
        ).pipe(
          Effect.tapError((error) => {
            if (error._tag !== "DotyposUncertain") return markSettled(pending);
            if (error.createdReservationIds)
              return markAmbiguous(move, error.createdReservationIds);
            return Effect.void;
          })
        )
      );
      return yield* continueMove(key, move, created);
    }).pipe(withPass(key.passId));
  });

  const reconcile = Effect.fn("PassDayMoves.reconcile")(function* (
    limit: number
  ) {
    const pending = yield* db
      .select({
        move: unlimitedPassDayMoves,
        passId: workspaceReservations.passId,
        serviceDate: workspaceReservations.serviceDate,
      })
      .from(unlimitedPassDayMoves)
      .innerJoin(
        workspaceReservations,
        eq(workspaceReservations.id, unlimitedPassDayMoves.reservationId)
      )
      .where(
        and(
          isNull(unlimitedPassDayMoves.settledAt),
          isNull(unlimitedPassDayMoves.ambiguousAt)
        )
      )
      .orderBy(
        asc(unlimitedPassDayMoves.checkedAt),
        asc(unlimitedPassDayMoves.generation)
      )
      .limit(Math.min(limit, 2));
    for (const { move, passId, serviceDate } of pending) {
      if (!passId || !serviceDate) continue;
      yield* Effect.gen(function* () {
        const [current] = yield* db
          .update(unlimitedPassDayMoves)
          .set({ checkedAt: yield* currentInstant })
          .where(stillPending(move))
          .returning();
        if (current)
          yield* continueMove(
            { passId, serviceDate, reservationId: current.reservationId },
            current
          );
      }).pipe(
        withPass(passId),
        WorkspaceLockSections.reservationCapacity([
          Temporal.PlainDate.from(serviceDate),
        ]),
        Effect.provideService(WorkspaceDatabaseAdvisoryLock, advisoryLock),
        Effect.timeout("30 seconds"),
        Effect.catch(() =>
          Effect.logWarning("Unlimited pass day move needs reconciliation")
        )
      );
    }
    return pending.length;
  });

  return { move: movePassDay, reconcile };
});

export class PassDayMoves extends Context.Service<
  PassDayMoves,
  Effect.Success<typeof makePassDayMoves>
>()("PassDayMoves") {
  static Default = Layer.effect(this, makePassDayMoves);
}
