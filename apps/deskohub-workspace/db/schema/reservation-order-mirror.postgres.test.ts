import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Pool, PoolClient } from "pg";
import {
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { waitForPostgresLockWaiter } from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  readReservationOrderMirror,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

/**
 * Inserts a Nexi attempt the way writers from before the mirror do, naming
 * no order.
 */
const insertAttemptSql = `insert into payment_attempts
    (id, workspace_reservation_id, provider, provider_order_id, state,
     amount_value, amount_exponent, currency)
  values ($1, $2, 'nexi', $3, $4, 29000, 2, 'CZK')`;

const attemptValues = (reservationId: string, state: "pending" | "paid") => {
  const id = `attempt-${crypto.randomUUID()}`;
  return [id, reservationId, `order-${crypto.randomUUID()}`, state] as const;
};

/** A transaction on its own connection that the test drives step by step. */
const openTransaction = async (pool: Pool) => {
  const client: PoolClient = await pool.connect();
  const {
    rows: [{ pid }],
  } = await client.query<{ readonly pid: number }>(
    "select pg_backend_pid() as pid"
  );
  await client.query("begin");
  // A wait on a lock the mirror added would surface as 55P03 here, not as a
  // hung test.
  await client.query("set local lock_timeout = '1s'");
  return {
    pid,
    query: (sql: string, values: readonly unknown[] = []) =>
      client.query(sql, [...values]),
    commit: async () => {
      await client.query("commit");
      client.release();
    },
    rollback: async () => {
      await client.query("rollback");
      client.release();
    },
  };
};

describe.skipIf(!testDatabase)("reservation order mirror on Postgres", () => {
  if (!testDatabase) return;
  const { pool } = testDatabase;
  const reservationIds: string[] = [];

  afterAll(async () => {
    await pool.query("delete from workspace_reservations where id = any($1)", [
      reservationIds,
    ]);
  });

  const insertReservation = async (
    stage: ReservationFixtureStage = { reservation: "held" }
  ) => {
    const { id } = await Effect.runPromise(
      workspaceFixtures(testDatabase.db).reservation({ stage })
    );
    reservationIds.push(id);
    return id;
  };

  const readOrderVersion = async (id: string) =>
    (
      await pool.query<{
        readonly version: string;
        readonly updated_at: string;
      }>(
        "select xmin::text as version, updated_at::text as updated_at from orders where id = $1",
        [id]
      )
    ).rows[0];

  test("mirrors a new reservation into an order with its ID", async () => {
    const id = await insertReservation({
      reservation: "confirmed",
      payment: "paid",
      fulfillment: "awaiting_delivery",
    });

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
    expect(mirror.order).toMatchObject({
      kind: "reservation",
      fulfillment_state: "awaiting_delivery",
    });
  });

  test("links an attempt that a writer from before the mirror inserts without an order", async () => {
    const id = await insertReservation();
    const values = attemptValues(id, "pending");

    await pool.query(insertAttemptSql, [...values]);

    const { rows } = await pool.query(
      "select order_id from payment_attempts where id = $1",
      [values[0]]
    );
    expect(rows).toEqual([{ order_id: id }]);
  });

  test("rejects an attempt that names another reservation's order", async () => {
    const id = await insertReservation();
    const other = await insertReservation();
    const [attemptId, , providerOrderId] = attemptValues(id, "pending");

    await expect(
      pool.query(
        `insert into payment_attempts
           (id, workspace_reservation_id, order_id, provider, provider_order_id,
            state, amount_value, amount_exponent, currency)
         values ($1, $2, $3, 'nexi', $4, 'pending', 29000, 2, 'CZK')`,
        [attemptId, id, other, providerOrderId]
      )
    ).rejects.toMatchObject({
      constraint: "payment_attempts_reservation_order_match_check",
    });
  });

  test.each([
    ["dotypos_customer_id", `fixture-customer-${crypto.randomUUID()}`],
    ["payment_state", "pending"],
    ["fulfillment_state", "processing"],
    ["active_payment_attempt_id", `attempt-${crypto.randomUUID()}`],
    ["paid_at", "2031-02-03T04:05:06.789Z"],
    ["fulfilled_at", "2031-02-03T04:05:06.789Z"],
    ["fulfillment_failed_at", "2031-02-03T04:05:06.789Z"],
    ["fulfillment_failure_code", "fixture_fulfillment_failure"],
  ])("mirrors a raw reservation update of %s alone", async (column, value) => {
    const id = await insertReservation();

    await pool.query(
      `update workspace_reservations set ${column} = $2 where id = $1`,
      [id, value]
    );

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
  });

  test("mirrors a raw reservation update's facts and its updated_at", async () => {
    const id = await insertReservation();
    const [attemptId, ...rest] = attemptValues(id, "pending");
    await pool.query(insertAttemptSql, [attemptId, ...rest]);
    const changedAt = "2031-02-03T04:05:06.789Z";

    await pool.query(
      `update workspace_reservations
          set payment_state = 'pending', active_payment_attempt_id = $2,
              updated_at = $3
        where id = $1`,
      [id, attemptId, changedAt]
    );

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
    expect(mirror.order).toMatchObject({
      payment_state: "pending",
      active_payment_attempt_id: attemptId,
    });
    expect(mirror.attemptOrderIds).toEqual([id]);
    const { rows } = await pool.query(
      "select (updated_at = $2::timestamptz) as mirrored from orders where id = $1",
      [id, changedAt]
    );
    expect(rows).toEqual([{ mirrored: true }]);
  });

  test("leaves the order untouched by a reservation write that changes no mirrored fact", async () => {
    const id = await insertReservation({
      reservation: "confirmed",
      payment: "paid",
      fulfillment: "processing",
    });
    const before = await readOrderVersion(id);

    // A fulfillment lease renewal writes only `updated_at`.
    await pool.query(
      "update workspace_reservations set updated_at = now() + interval '1 minute', locale = 'cs-CZ' where id = $1",
      [id]
    );

    expect(await readOrderVersion(id)).toEqual(before);
  });

  test("removes the order with its reservation", async () => {
    const id = await insertReservation();
    await pool.query(insertAttemptSql, [...attemptValues(id, "pending")]);

    await pool.query("delete from workspace_reservations where id = $1", [id]);

    const { rows } = await pool.query(
      `select (select count(*) from orders where id = $1)::int as orders,
              (select count(*) from payment_attempts where order_id = $1)::int as attempts`,
      [id]
    );
    expect(rows).toEqual([{ orders: 0, attempts: 0 }]);
  });

  test("lets an attempt insert pass a reservation update whose mirror holds the order", async () => {
    const id = await insertReservation();
    const reservationWrite = await openTransaction(pool);
    try {
      await reservationWrite.query(
        "update workspace_reservations set payment_state = 'pending' where id = $1",
        [id]
      );
      const attemptWrite = await openTransaction(pool);
      try {
        const values = attemptValues(id, "pending");
        await attemptWrite.query(insertAttemptSql, values);
        await attemptWrite.commit();
      } catch (error) {
        await attemptWrite.rollback();
        throw error;
      }
      await reservationWrite.commit();
    } catch (error) {
      await reservationWrite.rollback().catch(() => undefined);
      throw error;
    }

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
    expect(mirror.attemptOrderIds).toEqual([id]);
  });

  test("lets a reservation update mirror into an order an open attempt insert references", async () => {
    const id = await insertReservation();
    const attemptWrite = await openTransaction(pool);
    try {
      const [attemptId, ...rest] = attemptValues(id, "pending");
      await attemptWrite.query(insertAttemptSql, [attemptId, ...rest]);
      const reservationWrite = await openTransaction(pool);
      try {
        await reservationWrite.query(
          "update workspace_reservations set payment_state = 'pending' where id = $1",
          [id]
        );
        await reservationWrite.commit();
      } catch (error) {
        await reservationWrite.rollback();
        throw error;
      }
      await attemptWrite.commit();
    } catch (error) {
      await attemptWrite.rollback().catch(() => undefined);
      throw error;
    }

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toMatchObject({ payment_state: "pending" });
    expect(mirror.attemptOrderIds).toEqual([id]);
  });

  test("keeps an attempt-first payment waiting only on the reservation a reservation-first payment holds", async () => {
    const id = await insertReservation({
      reservation: "held",
      payment: "pending",
    });
    const [webhookAttemptId, ...webhookRest] = attemptValues(id, "pending");
    await pool.query(insertAttemptSql, [webhookAttemptId, ...webhookRest]);
    const paidAt = new Date().toISOString();

    // Reservation first, as an internal payment completes.
    const internalPayment = await openTransaction(pool);
    // Attempt first, as a Nexi webhook marks an attempt paid.
    const webhook = await openTransaction(pool);
    try {
      await internalPayment.query(
        "select id from workspace_reservations where id = $1 for update",
        [id]
      );
      await webhook.query(
        "update payment_attempts set state = 'paid', updated_at = now() where id = $1",
        [webhookAttemptId]
      );
      // The webhook now waits on the reservation row: an edge that predates
      // the mirror. Without a lock timeout of its own it waits it out.
      await webhook.query("set local lock_timeout = 0");
      const webhookReservation = webhook.query(
        `update workspace_reservations
            set payment_state = 'paid', paid_at = $2, updated_at = now()
          where id = $1`,
        [id, paidAt]
      );
      webhookReservation.catch(() => undefined);
      await waitForPostgresLockWaiter(pool, {
        condition: "$1::int = any(pg_blocking_pids(pid))",
        values: [internalPayment.pid],
        description: "the webhook waiting on the reservation row",
      });

      // The internal payment finishes under its 1 s lock timeout, so it never
      // waits on anything the webhook holds, the attempt it locked included.
      const [internalAttemptId, ...internalRest] = attemptValues(id, "paid");
      await internalPayment.query(insertAttemptSql, [
        internalAttemptId,
        ...internalRest,
      ]);
      await internalPayment.query(
        `update workspace_reservations
            set payment_state = 'paid', paid_at = $2,
                active_payment_attempt_id = $3, updated_at = now()
          where id = $1`,
        [id, paidAt, internalAttemptId]
      );
      await internalPayment.commit();

      await webhookReservation;
      await webhook.commit();
    } catch (error) {
      await internalPayment.rollback().catch(() => undefined);
      await webhook.rollback().catch(() => undefined);
      throw error;
    }

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
    expect(mirror.order).toMatchObject({ payment_state: "paid" });
    expect(mirror.attemptOrderIds).toEqual([id, id]);
  });

  test("keeps a reservation-first payment waiting only on the reservation an attempt-first payment holds", async () => {
    const id = await insertReservation({
      reservation: "held",
      payment: "pending",
    });
    const [webhookAttemptId, ...webhookRest] = attemptValues(id, "pending");
    await pool.query(insertAttemptSql, [webhookAttemptId, ...webhookRest]);
    const paidAt = new Date().toISOString();

    const webhook = await openTransaction(pool);
    const internalPayment = await openTransaction(pool);
    try {
      await webhook.query(
        "update payment_attempts set state = 'paid', updated_at = now() where id = $1",
        [webhookAttemptId]
      );
      // The webhook's reservation update mirrors into the order: it now holds
      // the reservation row and the order row.
      await webhook.query(
        `update workspace_reservations
            set payment_state = 'paid', paid_at = $2, updated_at = now()
          where id = $1`,
        [id, paidAt]
      );
      await internalPayment.query("set local lock_timeout = 0");
      const internalLock = internalPayment.query(
        "select id from workspace_reservations where id = $1 for update",
        [id]
      );
      internalLock.catch(() => undefined);
      await waitForPostgresLockWaiter(pool, {
        condition: "$1::int = any(pg_blocking_pids(pid))",
        values: [webhook.pid],
        description: "the internal payment waiting on the reservation row",
      });
      await webhook.commit();

      await internalLock;
      await internalPayment.query("set local lock_timeout = '1s'");
      const [internalAttemptId, ...internalRest] = attemptValues(id, "paid");
      await internalPayment.query(insertAttemptSql, [
        internalAttemptId,
        ...internalRest,
      ]);
      await internalPayment.query(
        `update workspace_reservations
            set active_payment_attempt_id = $2, updated_at = now()
          where id = $1`,
        [id, internalAttemptId]
      );
      await internalPayment.commit();
    } catch (error) {
      await webhook.rollback().catch(() => undefined);
      await internalPayment.rollback().catch(() => undefined);
      throw error;
    }

    const mirror = await readReservationOrderMirror(pool, id);
    expect(mirror.order).toEqual(mirror.expected);
    expect(mirror.attemptOrderIds).toEqual([id, id]);
  });
});
