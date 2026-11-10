import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect } from "effect";
import type { Pool } from "pg";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { createScratchPostgresDatabase } from "@/shared/testing/postgres-scratch-database.test-utils";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureInput,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { readReservationOrderMirror } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  countMigrationsFrom,
  linkMigrationsBefore,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261109124140_payment_order_mirror";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

/** The migration's backfill statements, which must be safe to run again. */
const backfillStatements = async () =>
  (
    await readFile(
      join(workspaceMigrationsFolder, MIGRATION_DIR, "migration.sql"),
      "utf8"
    )
  )
    .split("--> statement-breakpoint")
    .filter(
      (statement) =>
        statement.includes('SELECT "mirror_reservation_order"(reservation)') ||
        statement.trimStart().startsWith('UPDATE "payment_attempts"')
    );

type ScratchDatabase = {
  readonly pool: Pool;
  readonly reservation: (input: ReservationFixtureInput) => Promise<string>;
  readonly migrateRemaining: () => Promise<void>;
};

/**
 * Brings a scratch database to the state production is in before the
 * migration and hands it to `run`, which seeds it and applies the rest.
 */
const beforeMigration = async (
  run: (database: ScratchDatabase) => Promise<void>
) => {
  const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
  const scratch = await createScratchPostgresDatabase(
    testDatabaseUrl!,
    "payment_order_mirror"
  );
  const pool = makeDatabasePool({ connectionString: scratch.url, max: 4 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: earlierMigrations,
    });
    await pool.query("insert into customer_accounts (id) values ($1)", [
      fixtureReservationAuthorId,
    ]);
    const fixtures = workspaceFixtures(
      await Effect.runPromise(makeDatabaseClient(pool))
    );
    await run({
      pool,
      reservation: async (input) =>
        (await Effect.runPromise(fixtures.reservation(input))).id,
      migrateRemaining: () =>
        migrate(drizzle({ client: pool }), {
          migrationsFolder: workspaceMigrationsFolder,
        }),
    });
  } finally {
    await pool.end();
    await scratch.drop();
    await rm(earlierMigrations, { recursive: true, force: true });
  }
};

/**
 * Inserts a payment attempt as writers from before the migration do, without
 * an order, and makes it the reservation's active attempt when `active`.
 */
const insertAttempt = async (
  pool: Pool,
  reservationId: string,
  state: "pending" | "paid" | "failed",
  { active = false } = {}
) => {
  const id = `attempt-${crypto.randomUUID()}`;
  await pool.query(
    `insert into payment_attempts
       (id, workspace_reservation_id, provider, provider_order_id, state,
        failure_code, amount_value, amount_exponent, currency)
     values ($1, $2, 'nexi', $3, $4, $5, 29000, 2, 'CZK')`,
    [
      id,
      reservationId,
      `order-${crypto.randomUUID()}`,
      state,
      state === "failed" ? "payment_failed" : null,
    ]
  );
  if (active) {
    await pool.query(
      "update workspace_reservations set active_payment_attempt_id = $1 where id = $2",
      [id, reservationId]
    );
  }
  return id;
};

const insertOrder = (
  pool: Pool,
  order: { readonly id: string; readonly correlationId: string }
) =>
  pool.query(
    `insert into orders
       (id, kind, correlation_id, dotypos_customer_id, payment_state, fulfillment_state)
     values ($1, 'reservation', $2, 'fixture-colliding-customer', 'not_started', 'not_started')`,
    [order.id, order.correlationId]
  );

const correlationIdOf = async (pool: Pool, reservationId: string) =>
  (
    await pool.query<{ readonly correlation_id: string }>(
      "select correlation_id from workspace_reservations where id = $1",
      [reservationId]
    )
  ).rows[0]!.correlation_id;

/** The Postgres error a failed migration statement raised. */
const migrationFailure = async (migrated: Promise<void>) => {
  try {
    await migrated;
  } catch (error) {
    return (error as { readonly cause?: unknown }).cause;
  }
  throw new Error("The migration was expected to fail.");
};

/** What shows whether the migration applied: its column and journal rows. */
const migrationTrace = async (pool: Pool) => ({
  orderColumn: (
    await pool.query(
      `select 1 from information_schema.columns
        where table_name = 'payment_attempts' and column_name = 'order_id'`
    )
  ).rowCount,
  appliedMigrations: (
    await pool.query("select 1 from drizzle.__drizzle_migrations")
  ).rowCount,
});

/** Every row of both tables with its row version, to prove a no-op. */
const rowVersions = async (pool: Pool) => ({
  orders: (
    await pool.query(
      "select id, xmin::text as version, to_jsonb(orders)::text as row from orders order by id"
    )
  ).rows,
  attempts: (
    await pool.query(
      "select id, xmin::text as version, to_jsonb(payment_attempts)::text as row from payment_attempts order by id"
    )
  ).rows,
});

describe.skipIf(!testDatabaseUrl)(
  "payment order mirror migration on disposable Postgres",
  () => {
    test("mirrors every reservation into an order, links every attempt, and reruns as a no-op", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        const draft = await reservation({ stage: { reservation: "draft" } });
        const pending = await reservation({
          stage: { reservation: "held", payment: "pending" },
        });
        const pendingAttempt = await insertAttempt(pool, pending, "pending", {
          active: true,
        });
        const paid = await reservation({
          stage: { reservation: "confirmed", payment: "paid" },
        });
        const failedAttempt = await insertAttempt(pool, paid, "failed");
        const paidAttempt = await insertAttempt(pool, paid, "paid", {
          active: true,
        });
        const awaitingDelivery = await reservation({
          stage: {
            reservation: "confirmed",
            payment: "paid",
            fulfillment: "awaiting_delivery",
          },
        });
        const awaitingDeliveryAttempt = await insertAttempt(
          pool,
          awaitingDelivery,
          "paid",
          { active: true }
        );
        const fulfilled = await reservation({
          stage: {
            reservation: "confirmed",
            payment: "paid",
            fulfillment: "fulfilled",
          },
        });
        const fulfillmentFailed = await reservation({
          stage: {
            reservation: "confirmed",
            payment: "paid",
            fulfillment: "failed",
          },
        });

        await migrateRemaining();

        const reservations = [
          draft,
          pending,
          paid,
          awaitingDelivery,
          fulfilled,
          fulfillmentFailed,
        ];
        for (const id of reservations) {
          const mirror = await readReservationOrderMirror(pool, id);
          expect(mirror.order).toEqual(mirror.expected);
        }
        const { rows: updatedAt } = await pool.query(
          `select r.id from workspace_reservations r join orders o using (id)
            where o.updated_at is distinct from r.updated_at`
        );
        expect(updatedAt).toEqual([]);
        expect(
          (
            await pool.query<{ readonly fulfillment_state: string }>(
              "select fulfillment_state from orders where id = $1",
              [awaitingDelivery]
            )
          ).rows
        ).toEqual([{ fulfillment_state: "awaiting_delivery" }]);
        const { rows: links } = await pool.query(
          "select id, order_id from payment_attempts order by id"
        );
        expect(links).toEqual(
          [
            { id: pendingAttempt, order_id: pending },
            { id: failedAttempt, order_id: paid },
            { id: paidAttempt, order_id: paid },
            { id: awaitingDeliveryAttempt, order_id: awaitingDelivery },
          ].sort((left, right) => left.id.localeCompare(right.id, "en"))
        );

        const before = await rowVersions(pool);
        const rerunCounts: (number | null)[] = [];
        for (const statement of await backfillStatements()) {
          rerunCounts.push((await pool.query(statement)).rowCount);
        }
        expect(rerunCounts).toEqual([reservations.length, 0]);
        expect(await rowVersions(pool)).toEqual(before);
      });
    });

    test("refuses to adopt an order with a reservation's ID but another correlation ID", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        const id = await reservation({ stage: { reservation: "draft" } });
        await insertOrder(pool, { id, correlationId: crypto.randomUUID() });
        const before = await migrationTrace(pool);

        expect(await migrationFailure(migrateRemaining())).toMatchObject({
          code: "P0001",
          message: `Order ${id} is not the mirror of the reservation with that ID`,
        });
        expect(await migrationTrace(pool)).toEqual(before);
      });
    });

    test("refuses a reservation whose correlation ID another order holds", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        const id = await reservation({ stage: { reservation: "draft" } });
        await insertOrder(pool, {
          id: crypto.randomUUID(),
          correlationId: await correlationIdOf(pool, id),
        });
        const before = await migrationTrace(pool);

        expect(await migrationFailure(migrateRemaining())).toMatchObject({
          code: "23505",
          table: "orders",
        });
        expect(await migrationTrace(pool)).toEqual(before);
      });
    });

    test("gives up on a reservation write it waits for, applies nothing, and applies once the write ends", async () => {
      await beforeMigration(async ({ pool, reservation, migrateRemaining }) => {
        const id = await reservation({ stage: { reservation: "draft" } });
        const before = await migrationTrace(pool);
        const write = await holdPostgresTransaction(
          pool,
          "update workspace_reservations set payment_state = 'pending' where id = $1",
          [id]
        );
        try {
          const migrated = migrateRemaining();
          // Awaited below; never left unhandled while the write is held.
          migrated.catch(() => undefined);
          await waitForPostgresLockWaiter(pool, {
            condition: "$1::int = any(pg_blocking_pids(pid))",
            values: [write.pid],
            description: "the migration waiting on the uncommitted write",
          });
          expect(await migrationFailure(migrated)).toMatchObject({
            code: "55P03",
          });
          expect(await migrationTrace(pool)).toEqual(before);
        } finally {
          await write.commit();
        }

        await migrateRemaining();

        const mirror = await readReservationOrderMirror(pool, id);
        expect(mirror.order).toEqual(mirror.expected);
        expect(mirror.order?.payment_state).toBe("pending");
        expect(await migrationTrace(pool)).toEqual({
          orderColumn: 1,
          appliedMigrations:
            before.appliedMigrations! +
            (await countMigrationsFrom(MIGRATION_DIR)),
        });
      });
    });
  }
);
