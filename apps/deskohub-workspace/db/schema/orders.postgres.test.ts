import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import type { PoolClient } from "pg";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

interface OrderRow {
  readonly kind: string;
  readonly correlation_id?: string;
  readonly dotypos_customer_id: string;
  readonly payment_state: string;
  readonly fulfillment_state: string;
  readonly paid_at?: string;
  readonly fulfilled_at?: string;
  readonly fulfillment_failed_at?: string;
  readonly fulfillment_failure_code?: string;
}

const pendingReservationOrder: OrderRow = {
  kind: "reservation",
  dotypos_customer_id: "synthetic-order-customer",
  payment_state: "pending",
  fulfillment_state: "not_started",
};

const insertOrder = (client: PoolClient, row: OrderRow) => {
  const columns = Object.keys(row);
  return client.query<{ id: string; correlation_id: string }>(
    `insert into orders (${columns.join(", ")})
     values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
     returning id, correlation_id`,
    Object.values(row)
  );
};

/** Runs the scenario in a transaction that always rolls back. */
const withOrders = async (scenario: (client: PoolClient) => Promise<void>) => {
  const client = await postgresDatabase!.pool.connect();
  try {
    await client.query("begin");
    await scenario(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
};

/** Expects the insert to fail on `constraint` and keeps the transaction usable. */
const expectRejected = async (
  client: PoolClient,
  row: OrderRow,
  constraint: string
) => {
  await client.query("savepoint rejected_order");
  await expect(insertOrder(client, row)).rejects.toMatchObject({ constraint });
  await client.query("rollback to savepoint rejected_order");
};

describe.skipIf(!postgresDatabase)("orders on Postgres", () => {
  test("stores a reservation order with generated identities", async () => {
    await withOrders(async (client) => {
      const first = await insertOrder(client, pendingReservationOrder);
      const second = await insertOrder(client, pendingReservationOrder);

      const [firstOrder] = first.rows;
      const [secondOrder] = second.rows;
      expect(firstOrder?.id).toBeString();
      expect(firstOrder?.correlation_id).toBeString();
      expect(secondOrder?.id).not.toBe(firstOrder?.id);
      expect(secondOrder?.correlation_id).not.toBe(firstOrder?.correlation_id);
    });
  });

  test("rejects a reused correlation id", async () => {
    await withOrders(async (client) => {
      const {
        rows: [order],
      } = await insertOrder(client, pendingReservationOrder);

      await expectRejected(
        client,
        { ...pendingReservationOrder, correlation_id: order!.correlation_id },
        "orders_correlation_id_key"
      );
    });
  });

  test("accepts every lifecycle the states and their facts allow", async () => {
    await withOrders(async (client) => {
      const at = "2026-11-09T10:00:00Z";
      const rows: OrderRow[] = [
        { ...pendingReservationOrder, payment_state: "not_started" },
        { ...pendingReservationOrder, payment_state: "failed" },
        { ...pendingReservationOrder, payment_state: "cancelled" },
        { ...pendingReservationOrder, payment_state: "expired" },
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "processing",
        },
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "awaiting_delivery",
        },
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "fulfilled",
          fulfilled_at: at,
        },
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "failed",
          fulfillment_failed_at: at,
          fulfillment_failure_code: "synthetic_failure",
        },
      ];

      for (const row of rows) {
        await insertOrder(client, row);
      }
    });
  });

  test("rejects values outside the order vocabularies", async () => {
    await withOrders(async (client) => {
      await expectRejected(
        client,
        { ...pendingReservationOrder, kind: "goods" },
        "orders_kind_check"
      );
      await expectRejected(
        client,
        { ...pendingReservationOrder, payment_state: "refunded" },
        "orders_payment_state_check"
      );
      await expectRejected(
        client,
        { ...pendingReservationOrder, fulfillment_state: "shipped" },
        "orders_fulfillment_state_check"
      );
    });
  });

  test("rejects a blank customer", async () => {
    await withOrders(async (client) => {
      await expectRejected(
        client,
        { ...pendingReservationOrder, dotypos_customer_id: "  " },
        "orders_dotypos_customer_id_check"
      );
    });
  });

  test("rejects a state without the facts it records", async () => {
    await withOrders(async (client) => {
      const at = "2026-11-09T10:00:00Z";
      await expectRejected(
        client,
        { ...pendingReservationOrder, payment_state: "paid" },
        "orders_paid_at_check"
      );
      await expectRejected(
        client,
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "fulfilled",
        },
        "orders_fulfilled_check"
      );
      await expectRejected(
        client,
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "failed",
          fulfillment_failed_at: at,
        },
        "orders_fulfillment_failed_check"
      );
      await expectRejected(
        client,
        {
          ...pendingReservationOrder,
          payment_state: "paid",
          paid_at: at,
          fulfillment_state: "failed",
          fulfillment_failure_code: "synthetic_failure",
        },
        "orders_fulfillment_failed_check"
      );
    });
  });
});
