import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { orders, paymentAttempts, workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ensureReservationOrder } from "./reservation-order";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

/** Mirrored columns: the exact facts the order copies from the reservation. */
const mirroredColumns = [
  "correlationId",
  "dotyposCustomerId",
  "paymentState",
  "fulfillmentState",
  "activePaymentAttemptId",
  "paidAt",
  "fulfilledAt",
  "fulfillmentFailedAt",
  "fulfillmentFailureCode",
  "createdAt",
  "updatedAt",
] as const;

const holdExpiresAt = Temporal.Instant.from("2026-09-26T10:00:00.000Z");

describe.skipIf(!postgresDatabase)("ensureReservationOrder on Postgres", () => {
  const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
  const fixtureReservationIds: WorkspaceReservationId[] = [];

  const insertReservation = async (
    values: Partial<typeof workspaceReservations.$inferInsert> = {}
  ) => {
    const id = workspaceReservationIdSchema.make(crypto.randomUUID());
    await Effect.runPromise(
      postgres.db.insert(workspaceReservations).values({
        id,
        checkoutAttemptKey: checkoutAttemptKeySchema.make(
          `attempt-${crypto.randomUUID()}`
        ),
        dotyposCustomerId: DotyposCustomerIdSchema.make(
          `customer-${crypto.randomUUID()}`
        ),
        dotyposReservationId: DotyposReservationIdSchema.make(
          `dotypos-reservation-${crypto.randomUUID()}`
        ),
        reservationState: "held",
        paymentState: "not_started",
        fulfillmentState: "not_started",
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: false,
        },
        locale: "en-US",
        ...values,
      })
    );
    fixtureReservationIds.push(id);
    return id;
  };

  const mirror = (reservation: typeof workspaceReservations.$inferSelect) =>
    postgres.db.transaction((tx) =>
      ensureReservationOrder({ tx, reservation })
    );

  const loadReservation = async (id: WorkspaceReservationId) => {
    const [row] = await Effect.runPromise(
      postgres.db
        .select()
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, id))
        .limit(1)
    );
    if (!row) throw new Error(`fixture reservation ${id} disappeared`);
    return row;
  };

  const loadOrder = async (id: WorkspaceReservationId) => {
    const [row] = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, id)).limit(1)
    );
    if (!row) throw new Error(`order ${id} is missing`);
    return row;
  };

  /** Every mirrored column, including timestamps, must equal the row. */
  const expectOrderMirrors = (
    order: typeof orders.$inferSelect,
    reservation: typeof workspaceReservations.$inferSelect
  ) => {
    for (const column of mirroredColumns) {
      expect(order[column]).toEqual(reservation[column]);
    }
  };

  afterEach(async () => {
    if (fixtureReservationIds.length === 0) return;
    const ids = [...fixtureReservationIds];
    fixtureReservationIds.length = 0;
    await Effect.runPromise(
      postgres.db
        .delete(orders)
        .where(inArray(orders.id, ids as readonly string[]))
    );
    await Effect.runPromise(
      postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.id, ids))
    );
  });

  test("stays idempotent on repeated calls and mirrors every reservation fact", async () => {
    const id = await insertReservation();

    const first = await Effect.runPromise(mirror(await loadReservation(id)));
    expect(first.id).toBe(id);
    expect(first.kind).toBe("reservation");

    // A repeat call must not duplicate; it re-mirrors the same facts.
    const second = await Effect.runPromise(mirror(await loadReservation(id)));
    expect(second.id).toBe(id);
    for (const column of mirroredColumns) {
      expect(second[column]).toEqual(first[column]);
    }

    const orderRows = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, id))
    );
    expect(orderRows).toHaveLength(1);
    for (const column of mirroredColumns) {
      expect(orderRows[0]![column]).toEqual(
        (await loadReservation(id))[column]
      );
    }
  });

  test("keeps the mirror lossless across paid, fulfilled, and failed transitions", async () => {
    const id = await insertReservation();

    // Payment transition: paid without fulfillment.
    const paidAtInstant = Temporal.Now.instant();
    const [paid] = await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({
          paymentState: "paid",
          paidAt: paidAtInstant,
          updatedAt: paidAtInstant,
        })
        .where(eq(workspaceReservations.id, id))
        .returning()
    );
    await Effect.runPromise(mirror(paid!));

    // Fulfillment transition: fulfilled.
    const fulfilledAtInstant = Temporal.Now.instant();
    const [fulfilled] = await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({
          fulfillmentState: "fulfilled",
          fulfilledAt: fulfilledAtInstant,
          updatedAt: fulfilledAtInstant,
        })
        .where(eq(workspaceReservations.id, id))
        .returning()
    );
    const mirroredFulfilled = await Effect.runPromise(mirror(fulfilled!));

    const reservation = await loadReservation(id);
    const [order] = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, id))
    );
    expect(order).toBeDefined();
    for (const column of mirroredColumns) {
      expect(order![column]).toEqual(reservation[column]);
    }
    // The failed timestamps were never set on this lifecycle.
    expect(mirroredFulfilled.fulfillmentFailedAt).toBeNull();
    expect(mirroredFulfilled.fulfillmentFailureCode).toBeNull();

    // A second reservation exercises the failure mirror.
    const failedId = await insertReservation();
    const failedAtInstant = Temporal.Now.instant();
    const [failed] = await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({
          fulfillmentState: "failed",
          fulfilledAt: null,
          fulfillmentFailedAt: failedAtInstant,
          fulfillmentFailureCode: "fulfillment_email_failed",
          updatedAt: failedAtInstant,
        })
        .where(eq(workspaceReservations.id, failedId))
        .returning()
    );
    await Effect.runPromise(mirror(failed!));
    const failedOrder = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, failedId))
    );
    const failedReservation = await loadReservation(failedId);
    expect(failedOrder).toHaveLength(1);
    for (const column of mirroredColumns) {
      expect(failedOrder[0]![column]).toEqual(failedReservation[column]);
    }
  });

  test("dies instead of overwriting an order with a non-reservation kind", async () => {
    const id = await insertReservation();
    const futureKind = "future_kind";

    // Simulate a future second order kind that today's kind check forbids.
    await postgres.pool.query(
      "alter table orders drop constraint if exists orders_kind_check"
    );
    try {
      await postgres.pool.query(
        `insert into orders (id, kind, correlation_id, dotypos_customer_id, payment_state, fulfillment_state)
           values ($1, $2, $3, $4, 'not_started', 'not_started')`,
        [
          id,
          futureKind,
          `correlation-${crypto.randomUUID()}`,
          `customer-${crypto.randomUUID()}`,
        ]
      );

      await expect(
        Effect.runPromise(mirror(await loadReservation(id)))
      ).rejects.toThrow("non-reservation kind");

      // The conflicting row kept its kind; the upsert never revived it.
      const conflicting = await postgres.pool.query(
        "select kind from orders where id = $1",
        [id]
      );
      expect(conflicting.rows[0]?.kind).toBe(futureKind);
    } finally {
      // Remove the conflicting row before restoring the kind check.
      await postgres.pool
        .query("delete from orders where id = $1 and kind = $2", [
          id,
          futureKind,
        ])
        .catch(() => {});
      await postgres.pool.query(
        "alter table orders add constraint orders_kind_check check (kind in ('reservation'))"
      );
    }
  });

  test("creates exactly one order through the reservation create/upsert path", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const sessionKey = checkoutAttemptKeySchema.make(
      `session-${crypto.randomUUID()}`
    );
    const attemptKey = checkoutAttemptKeySchema.make(
      `attempt-${crypto.randomUUID()}`
    );
    const input = {
      checkoutSessionKey: sessionKey,
      checkoutAttemptKey: attemptKey,
      dotyposCustomerId: DotyposCustomerIdSchema.make(
        `customer-${crypto.randomUUID()}`
      ),
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      locale: "en-US",
      reservationHoldExpiresAt: holdExpiresAt,
    } as const;

    const created = await Effect.runPromise(reservations.createDraft(input));
    fixtureReservationIds.push(created.id);

    const ordersAfterCreate = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, created.id))
    );
    expect(ordersAfterCreate).toHaveLength(1);
    expect(ordersAfterCreate[0]!.kind).toBe("reservation");

    // A retried submission with the same attempt key re-enters the upsert
    // path but must never duplicate the order.
    const replayed = await Effect.runPromise(reservations.createDraft(input));
    expect(replayed.id).toBe(created.id);
    const ordersAfterReplay = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, created.id))
    );
    expect(ordersAfterReplay).toHaveLength(1);
  });

  test("keeps the paid-but-not-fulfilled mirror from becoming invoice-eligible", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const invoiceEligible = (order: typeof orders.$inferSelect) =>
      order.fulfillmentState === "fulfilled" && order.fulfilledAt !== null;

    const id = await insertReservation();
    const paidAtInstant = Temporal.Now.instant();
    const [paid] = await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({
          paymentState: "paid",
          paidAt: paidAtInstant,
          updatedAt: paidAtInstant,
        })
        .where(eq(workspaceReservations.id, id))
        .returning()
    );
    await Effect.runPromise(mirror(paid!));

    // Paid but not fulfilled: the mirror must not be invoice-eligible.
    const processing = await Effect.runPromise(
      reservations.claimPaidFulfillment({
        id,
        staleProcessingBefore: Temporal.Now.instant(),
      })
    );
    expect(processing?.fulfillmentState).toBe("processing");
    const mirroredProcessing = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, id))
    );
    expect(mirroredProcessing).toHaveLength(1);
    expect(invoiceEligible(mirroredProcessing[0]!)).toBe(false);
  });

  test("supersession gives both reservations their own order atomically", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const originalId = await insertReservation({
      reservationState: "held",
      paymentState: "not_started",
      dotyposReservationId: DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      ),
    });
    const claimed = await Effect.runPromise(
      reservations.claimSupersessionCancellation(originalId)
    );
    expect(claimed?.reservationState).toBe("cancelling");

    const cancelledAt = Temporal.Now.instant();
    const replacement = await Effect.runPromise(
      reservations.completeSupersessionAndCreateDraft({
        cancelledReservationId: originalId,
        cancelledAt,
        replacement: {
          checkoutSessionKey: checkoutAttemptKeySchema.make(
            `session-${crypto.randomUUID()}`
          ),
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${crypto.randomUUID()}`
          ),
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          reservationHoldExpiresAt: holdExpiresAt,
        },
      })
    );
    fixtureReservationIds.push(replacement.id);

    // After the commit, before any payment starts, both reservation IDs own
    // their own same-ID order.
    const originalOrder = await loadOrder(originalId);
    const replacementOrder = await loadOrder(replacement.id);
    expect(originalOrder.kind).toBe("reservation");
    expect(replacementOrder.kind).toBe("reservation");
    expectOrderMirrors(originalOrder, await loadReservation(originalId));
    expectOrderMirrors(replacementOrder, await loadReservation(replacement.id));
    expect(replacementOrder.paymentState).toBe("not_started");
    expect(replacement.id).not.toBe(originalId);
  });

  test("hold lifecycle transitions re-mirror every column including timestamps", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const id = await insertReservation({
      reservationState: "draft",
      fulfillmentState: "processing",
      paymentState: "paid",
      paidAt: Temporal.Now.instant(),
    });

    expect(await Effect.runPromise(reservations.claimHoldCreation(id))).toBe(
      true
    );
    expectOrderMirrors(await loadOrder(id), await loadReservation(id));

    const reservedAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.attachHold({
        id,
        dotyposReservationId: DotyposReservationIdSchema.make(
          `dotypos-reservation-${crypto.randomUUID()}`
        ),
        reservationCreatedAt: reservedAt,
        reservationHoldExpiresAt: holdExpiresAt,
      })
    );
    expectOrderMirrors(await loadOrder(id), await loadReservation(id));

    await Effect.runPromise(
      reservations.updateReservationDetails({
        id,
        reservationDetails: {
          kind: "cowork",
          entryTier: "basic",
          coffee: true,
        },
        locale: "cs-CZ",
      })
    );
    expectOrderMirrors(await loadOrder(id), await loadReservation(id));

    const confirmedAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.markReservationConfirmed({ id, confirmedAt })
    );
    const [reservation, order] = await Promise.all([
      loadReservation(id),
      loadOrder(id),
    ]);
    expectOrderMirrors(order, reservation);
    // The mirrored updatedAt is not stale: it equals the authoritative row.
    expect(order.updatedAt).toEqual(reservation.updatedAt);
  });

  test("markCancelled and claimPaidFulfillment re-mirror cancellation and fulfillment facts", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const cancellationId = await insertReservation({
      reservationState: "held",
      dotyposReservationId: DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      ),
    });
    await Effect.runPromise(reservations.claimCancellation(cancellationId));
    expectOrderMirrors(
      await loadOrder(cancellationId),
      await loadReservation(cancellationId)
    );
    const cancelledAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.markCancelled({ id: cancellationId, cancelledAt })
    );
    const cancelledReservation = await loadReservation(cancellationId);
    const cancelledOrder = await loadOrder(cancellationId);
    expectOrderMirrors(cancelledOrder, cancelledReservation);
    expect(cancelledOrder.paymentState).toEqual(
      cancelledReservation.paymentState
    );
    expect(cancelledOrder.updatedAt).toEqual(cancelledReservation.updatedAt);

    const fulfilledId = await insertReservation({
      paymentState: "paid",
      paidAt: Temporal.Now.instant(),
      reservationState: "held",
      dotyposReservationId: DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      ),
    });
    await Effect.runPromise(
      reservations.claimPaidFulfillment({
        id: fulfilledId,
        staleProcessingBefore: Temporal.Now.instant(),
      })
    );
    const fulfilledAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.markFulfilled({ id: fulfilledId, fulfilledAt })
    );
    expectOrderMirrors(
      await loadOrder(fulfilledId),
      await loadReservation(fulfilledId)
    );
  });

  test("relinks legacy payment attempts left unlinked by old writers", async () => {
    const id = await insertReservation();
    const [attempt] = await Effect.runPromise(
      postgres.db
        .insert(paymentAttempts)
        .values({
          workspaceReservationId: id,
          provider: "nexi",
          providerOrderId: `order-${crypto.randomUUID()}` as never,
          state: "created",
          amountValue: 35_000,
          amountExponent: 2,
          currency: "CZK",
        })
        .returning()
    );
    expect(attempt!.orderId).toBeNull();

    await Effect.runPromise(mirror(await loadReservation(id)));

    const [relattempt] = await Effect.runPromise(
      postgres.db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attempt!.id))
        .limit(1)
    );
    // The persisted linkage equals the reservation id, not a synthesized one.
    expect(relattempt!.orderId).toBe(id);
  });

  test("mirrors fulfilled + fulfilledAt so the invoice gate can open", async () => {
    const reservations = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* WorkspaceReservationRepository;
      }).pipe(
        Effect.provide(
          WorkspaceReservationRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as IWorkspaceReservationRepository;

    const id = await insertReservation();
    const paidAtInstant = Temporal.Now.instant();
    const [paid] = await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({
          paymentState: "paid",
          paidAt: paidAtInstant,
          updatedAt: paidAtInstant,
        })
        .where(eq(workspaceReservations.id, id))
        .returning()
    );
    await Effect.runPromise(mirror(paid!));

    await Effect.runPromise(
      reservations.claimPaidFulfillment({
        id,
        staleProcessingBefore: Temporal.Now.instant(),
      })
    );
    const markFulfilledAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.markFulfilled({ id, fulfilledAt: markFulfilledAt })
    );

    const fulfilledOrder = await Effect.runPromise(
      postgres.db.select().from(orders).where(eq(orders.id, id))
    );
    expect(fulfilledOrder).toHaveLength(1);
    // After fulfillment the mirror carries exactly the invoice-gate state.
    expect(fulfilledOrder[0]!.fulfillmentState).toBe("fulfilled");
    expect(fulfilledOrder[0]!.fulfilledAt).not.toBeNull();
  });
});
