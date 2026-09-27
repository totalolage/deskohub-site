import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  latePaymentRecoveries,
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  type ILatePaymentRecoveryRepository,
  LatePaymentRecoveryRepository,
} from "@/features/checkout/backend/repositories/late-payment-recovery.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "@/features/checkout/backend/repositories/payment-lifecycle.repository";
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
        .delete(latePaymentRecoveries)
        .where(inArray(latePaymentRecoveries.workspaceReservationId, ids))
    );
    await postgres.pool.query(
      "update orders set active_payment_attempt_id = null where id = any($1::text[])",
      [ids]
    );
    await postgres.pool.query(
      "update payment_attempts set order_id = null where workspace_reservation_id = any($1::text[])",
      [ids]
    );
    await Effect.runPromise(
      postgres.db
        .delete(paymentAttempts)
        .where(inArray(paymentAttempts.workspaceReservationId, ids))
    );
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

  test("never touches payment attempts; an explicitly locked attempt only delays the FK check", async () => {
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
    await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({ activePaymentAttemptId: attempt!.id })
        .where(eq(workspaceReservations.id, id))
    );

    // Hold the attempt row with FOR UPDATE while the reservation-only mirror
    // runs. The mirror's order FK check requests KEY SHARE, which FOR UPDATE
    // blocks. The mirror must wait for the anchor to release and then
    // complete without mutating the attempt; legacy relinking belongs to
    // attempt-first payment writers.
    const latch = await postgres.pool.connect();
    let mirrored: Promise<unknown>;
    let blockedOnAttempt = false;
    try {
      await latch.query("begin");
      await latch.query(
        "select state from payment_attempts where id = $1 for update",
        [attempt!.id]
      );

      mirrored = Effect.runPromise(mirror(await loadReservation(id)));

      // Observe the exact blocked orders upsert, not unrelated pooled activity.
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where pid <> pg_backend_pid()
              and wait_event_type = 'Lock'
              and query ilike '%insert into "orders"%'
            limit 1`
        );
        if (rows.length > 0) {
          blockedOnAttempt = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      await latch.query("commit");
    } finally {
      await latch.query("rollback").catch(() => {});
      latch.release();
    }

    expect(blockedOnAttempt).toBe(true);
    await mirrored;
    const [afterMirror] = await Effect.runPromise(
      postgres.db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attempt!.id))
        .limit(1)
    );
    expect(afterMirror!.orderId).toBeNull();
  });

  test("reservation-only mirrors complete with late-payment recovery holding the attempt first", async () => {
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
    const recovery = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* LatePaymentRecoveryRepository;
      }).pipe(
        Effect.provide(
          LatePaymentRecoveryRepository.Default.pipe(
            Layer.provide(postgres.layer)
          )
        )
      )
    )) as ILatePaymentRecoveryRepository;

    // Mixed-version legacy shape: an old writer left the attempt unlinked
    // and pointed the reservation's active attempt at it.
    const legacyFixture = async () => {
      const id = await insertReservation({
        paymentState: "failed",
        failureCode: "provider_declined",
      });
      const [attempt] = await Effect.runPromise(
        postgres.db
          .insert(paymentAttempts)
          .values({
            workspaceReservationId: id,
            provider: "nexi",
            providerOrderId: `order-${crypto.randomUUID()}` as never,
            state: "failed",
            failureCode: "provider_declined",
            amountValue: 35_000,
            amountExponent: 2,
            currency: "CZK",
          })
          .returning()
      );
      await Effect.runPromise(
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: attempt!.id })
          .where(eq(workspaceReservations.id, id))
      );
      return { id, attempt: attempt! };
    };

    // Variant 1: the Order row is entirely missing; the mirror INSERT sets
    // active_payment_attempt_id, so the orders FK check takes FOR KEY SHARE
    // on the attempt row.
    const missing = await legacyFixture();

    // Variant 2: the Order row exists but its active attempt is stale; the
    // mirror's ON CONFLICT DO UPDATE rewrites it, hitting the same FK check.
    const stale = await legacyFixture();
    await Effect.runPromise(mirror(await loadReservation(stale.id)));
    await postgres.pool.query(
      "update orders set active_payment_attempt_id = null where id = $1",
      [stale.id]
    );

    const waitForLockWait = async (queryPattern: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where pid <> pg_backend_pid()
              and wait_event_type = 'Lock'
              and query ilike $1
            limit 1`,
          [queryPattern]
        );
        if (rows.length > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };

    await postgres.pool.query(`
      create or replace function workspace_test_pause_order_mirror()
      returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(hashtext(new.id), 247385);
        return new;
      end;
      $$
    `);
    await postgres.pool.query(
      "drop trigger if exists workspace_test_pause_order_mirror on orders"
    );
    await postgres.pool.query(`
      create trigger workspace_test_pause_order_mirror
      before insert or update on orders
      for each row execute function workspace_test_pause_order_mirror()
    `);

    try {
      for (const fixture of [missing, stale]) {
        const latch = await postgres.pool.connect();
        const pending: Promise<unknown>[] = [];
        try {
          // Pause the mirror after it owns the reservation row but immediately
          // before the order write performs its active-attempt FK check.
          await latch.query("select pg_advisory_lock(hashtext($1), 247385)", [
            fixture.id,
          ]);
          const mirrored = Effect.runPromise(
            reservations.updateReservationDetails({
              id: fixture.id,
              reservationDetails: {
                kind: "cowork",
                entryTier: "basic",
                coffee: true,
              },
              locale: "cs-CZ",
            })
          );
          pending.push(mirrored);
          expect(await waitForLockWait('%insert into "orders"%')).toBe(true);

          // Recovery takes the same attempt anchor before it may wait for the
          // reservation, so it serializes behind the new reservation mirror.
          const recoveryStart = Effect.runPromise(
            recovery.start({
              paymentAttemptId: fixture.attempt.id,
              workspaceReservationId: fixture.id,
              webhookEventId: `event-${crypto.randomUUID()}` as never,
              providerStatus: "APPROVED",
              verifiedPaidAt: Temporal.Now.instant(),
            })
          );
          pending.push(recoveryStart);
          expect(
            await waitForLockWait('%from "payment_attempts"%for no key update%')
          ).toBe(true);

          // Releasing the mirror lets its transaction commit; recovery then
          // obtains the reservation and persists its legacy order_id relink.
          await latch.query("select pg_advisory_unlock(hashtext($1), 247385)", [
            fixture.id,
          ]);
          const [details, started] = await Promise.all([
            mirrored,
            recoveryStart,
          ]);
          expect(details).toMatchObject({ locale: "cs-CZ" });
          expect(started.state).toBe("pending");
        } finally {
          await latch
            .query("select pg_advisory_unlock(hashtext($1), 247385)", [
              fixture.id,
            ])
            .catch(() => {});
          await Promise.allSettled(pending);
          latch.release();
        }

        const [attempt] = await Effect.runPromise(
          postgres.db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, fixture.attempt.id))
            .limit(1)
        );
        expect(attempt!.state).toBe("failed");
        expect(attempt!.orderId).toBe(fixture.id);

        const [reservation, order, recoveryRow] = await Promise.all([
          loadReservation(fixture.id),
          loadOrder(fixture.id),
          Effect.runPromise(
            recovery.findByPaymentAttemptId(fixture.attempt.id)
          ),
        ]);
        expect(reservation.locale).toBe("cs-CZ");
        expect(order.activePaymentAttemptId).toBe(fixture.attempt.id);
        expectOrderMirrors(order, reservation);
        expect(recoveryRow?.state).toBe("pending");
      }
    } finally {
      await postgres.pool.query(
        "drop trigger if exists workspace_test_pause_order_mirror on orders"
      );
      await postgres.pool.query(
        "drop function if exists workspace_test_pause_order_mirror()"
      );
    }
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
    const customerEmailDeliveryId = `delivery-${crypto.randomUUID()}` as never;
    await Effect.runPromise(
      reservations.markAwaitingCustomerEmailDelivery({
        id,
        customerEmailDeliveryId,
      })
    );
    const [awaitingReservation, awaitingOrder] = await Promise.all([
      loadReservation(id),
      loadOrder(id),
    ]);
    expect(awaitingReservation.fulfillmentState).toBe("awaiting_delivery");
    expect(awaitingReservation.fulfilledAt).toBeNull();
    expectOrderMirrors(awaitingOrder, awaitingReservation);

    const markFulfilledAt = Temporal.Now.instant();
    await Effect.runPromise(
      reservations.markCustomerEmailDeliveryFulfilled({
        customerEmailDeliveryId,
        fulfilledAt: markFulfilledAt,
      })
    );

    const [fulfilledReservation, fulfilledOrder] = await Promise.all([
      loadReservation(id),
      loadOrder(id),
    ]);
    expect(fulfilledReservation.fulfillmentState).toBe("fulfilled");
    expect(
      fulfilledReservation.fulfilledAt?.toString({
        smallestUnit: "microsecond",
      })
    ).toBe(markFulfilledAt.toString({ smallestUnit: "microsecond" }));
    expectOrderMirrors(fulfilledOrder, fulfilledReservation);
  });

  test("rolls back payment state, attempt linkage, and the Order together", async () => {
    const lifecycle = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* PaymentLifecycleRepository;
      }).pipe(
        Effect.provide(
          PaymentLifecycleRepository.Default.pipe(Layer.provide(postgres.layer))
        )
      )
    )) as IPaymentLifecycleRepository;

    const id = await insertReservation();
    const [attempt] = await Effect.runPromise(
      postgres.db
        .insert(paymentAttempts)
        .values({
          workspaceReservationId: id,
          provider: "nexi",
          providerOrderId: `order-${crypto.randomUUID()}` as never,
          state: "pending",
          amountValue: 35_000,
          amountExponent: 2,
          currency: "CZK",
        })
        .returning()
    );
    await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({ paymentState: "pending", activePaymentAttemptId: attempt!.id })
        .where(eq(workspaceReservations.id, id))
    );
    await Effect.runPromise(mirror(await loadReservation(id)));

    await postgres.pool.query(`
      create or replace function workspace_test_reject_order_mirror()
      returns trigger language plpgsql as $$
      begin
        raise exception 'workspace test rejected order mirror';
      end;
      $$
    `);
    await postgres.pool.query(`
      create trigger workspace_test_reject_order_mirror
      before insert or update on orders
      for each row execute function workspace_test_reject_order_mirror()
    `);

    try {
      let rejected = false;
      try {
        await Effect.runPromise(
          lifecycle.markPaid({
            id: attempt!.id,
            workspaceReservationId: id,
            providerStatus: "APPROVED",
            paidAt: Temporal.Now.instant(),
          })
        );
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      await postgres.pool.query(
        "drop trigger if exists workspace_test_reject_order_mirror on orders"
      );
      await postgres.pool.query(
        "drop function if exists workspace_test_reject_order_mirror()"
      );
    }

    const [reservationAfterRollback, attemptAfterRollback, orderAfterRollback] =
      await Promise.all([
        loadReservation(id),
        Effect.runPromise(
          postgres.db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, attempt!.id))
            .limit(1)
        ).then(([row]) => row!),
        loadOrder(id),
      ]);
    expect(reservationAfterRollback.paymentState).toBe("pending");
    expect(attemptAfterRollback.state).toBe("pending");
    expect(attemptAfterRollback.orderId).toBeNull();
    expect(orderAfterRollback.paymentState).toBe("pending");

    const replay = await Effect.runPromise(
      lifecycle.markPaid({
        id: attempt!.id,
        workspaceReservationId: id,
        providerStatus: "APPROVED",
        paidAt: Temporal.Now.instant(),
      })
    );
    expect(replay.changed).toBe(true);

    const [reservation, order, attemptAfterReplay] = await Promise.all([
      loadReservation(id),
      loadOrder(id),
      Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attempt!.id))
          .limit(1)
      ).then(([row]) => row!),
    ]);
    expect(reservation.paymentState).toBe("paid");
    expect(order.paymentState).toBe("paid");
    expect(attemptAfterReplay.orderId).toBe(id);
    expect(
      await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      )
    ).toHaveLength(1);
  });

  test("markPaid anchors on the attempt row and repairs its linkage without a lock-order abort", async () => {
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
    const lifecycle = (await Effect.runPromise(
      Effect.gen(function* () {
        return yield* PaymentLifecycleRepository;
      }).pipe(
        Effect.provide(
          PaymentLifecycleRepository.Default.pipe(Layer.provide(postgres.layer))
        )
      )
    )) as IPaymentLifecycleRepository;

    const id = await insertReservation({
      reservationState: "held",
      paymentState: "pending",
    });
    // Production always has the order from the reservation create path.
    await Effect.runPromise(mirror(await loadReservation(id)));
    // Legacy old-writer shape: the attempt carries no order linkage yet; the
    // payment path itself must repair it.
    const [attempt] = await Effect.runPromise(
      postgres.db
        .insert(paymentAttempts)
        .values({
          workspaceReservationId: id,
          provider: "nexi",
          providerOrderId: `order-${crypto.randomUUID()}` as never,
          state: "pending",
          amountValue: 35_000,
          amountExponent: 2,
          currency: "CZK",
        })
        .returning()
    );
    await Effect.runPromise(
      postgres.db
        .update(workspaceReservations)
        .set({ activePaymentAttemptId: attempt!.id })
        .where(eq(workspaceReservations.id, id))
    );
    expect(attempt!.orderId).toBeNull();

    // Connection A plays the legacy writer: it grabs the payment attempt row
    // first and pauses, exactly the interleaving the new attempt-first anchor
    // must serialize against.
    const latch = await postgres.pool.connect();
    let markPaid:
      | Promise<{
          changed: boolean;
          attempt: { id: string; state: string; orderId: string | null };
        }>
      | undefined;
    let details: Promise<{ readonly locale: string }> | undefined;
    const waitForLockWait = async (queryPattern: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rows } = await postgres.pool.query(
          `select 1 from pg_stat_activity
            where wait_event_type = 'Lock'
              and query ilike $1 limit 1`,
          [queryPattern]
        );
        if (rows.length > 0) return true;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return false;
    };
    try {
      await latch.query("begin");
      await latch.query(
        "update payment_attempts set updated_at = updated_at where id = $1",
        [attempt!.id]
      );

      // A reservation-only mirror now takes a compatible attempt anchor
      // before the reservation. It waits here instead of holding the
      // reservation while the order FK checks the active attempt.
      details = Effect.runPromise(
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
      expect(
        await waitForLockWait('%from "payment_attempts"%for no key update%')
      ).toBe(true);
      const reservationProbe = await postgres.pool.query(
        "select 1 from workspace_reservations where id = $1 for update nowait",
        [id]
      );
      expect(reservationProbe.rowCount).toBe(1);

      // markPaid shares that attempt-first order and waits without reserving
      // the reservation row.
      markPaid = Effect.runPromise(
        lifecycle.markPaid({
          id: attempt!.id as never,
          workspaceReservationId: id,
          providerStatus: "APPROVED",
          paidAt: Temporal.Now.instant(),
        })
      );

      expect(await waitForLockWait('%update "payment_attempts"%')).toBe(true);

      // Neither waiting writer may own the reservation row yet.
      const secondReservationProbe = await postgres.pool.query(
        "select 1 from workspace_reservations where id = $1 for update nowait",
        [id]
      );
      expect(secondReservationProbe.rowCount).toBe(1);

      // Releasing the legacy writer lets both new writers proceed without a
      // deadlock abort.
      await latch.query("commit");
    } finally {
      await latch.query("rollback").catch(() => {});
      latch.release();
    }

    const [transition, detailsResult] = await Promise.all([
      markPaid!,
      details!,
    ]);
    expect(detailsResult.locale).toBe("cs-CZ");
    expect(transition.changed).toBe(true);
    expect(transition.attempt.state).toBe("paid");
    expect(transition.attempt.orderId).toBe(id);

    const [reservation, order] = await Promise.all([
      loadReservation(id),
      loadOrder(id),
    ]);
    expect(reservation.paymentState).toBe("paid");
    expect(reservation.paidAt).not.toBeNull();
    expect(order.paymentState).toBe("paid");
    expect(order.paidAt).not.toBeNull();
    expect(order.activePaymentAttemptId).toBe(attempt!.id);
    // The interleaving left the persisted attempt linkage intact.
    const [relinked] = await Effect.runPromise(
      postgres.db
        .select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.id, attempt!.id))
        .limit(1)
    );
    expect(relinked!.orderId).toBe(id);
  });
});
