import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orders } from "./orders";

const migrationUrl = new URL(
  "../migrations/20260926122710_order_foundation/migration.sql",
  import.meta.url
);

describe("orders", () => {
  test("stores the reservation order lifecycle facts", () => {
    const orderConfig = getTableConfig(orders);

    expect(orderConfig.columns.map(({ name }) => name)).toEqual([
      "id",
      "kind",
      "correlation_id",
      "dotypos_customer_id",
      "payment_state",
      "fulfillment_state",
      "paid_at",
      "fulfilled_at",
      "fulfillment_failed_at",
      "fulfillment_failure_code",
      "created_at",
      "updated_at",
    ]);
    expect(orderConfig.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "orders_kind_check",
        "orders_payment_state_check",
        "orders_fulfillment_state_check",
        "orders_dotypos_customer_id_check",
        "orders_paid_at_check",
        "orders_fulfilled_check",
        "orders_fulfillment_failed_check",
      ])
    );
    expect(orderConfig.foreignKeys).toHaveLength(0);
  });

  test("migration creates only the orders table with state and consistency checks", async () => {
    const migration = await Bun.file(migrationUrl).text();

    expect(migration).toContain('CREATE TABLE "orders"');
    expect(migration).toContain("orders_kind_check");
    expect(migration).toContain("orders_payment_state_check");
    expect(migration).toContain("orders_fulfillment_state_check");
    expect(migration).toContain("awaiting_delivery");
    expect(migration).toContain("orders_paid_at_check");
    expect(migration).toContain("orders_fulfilled_check");
    expect(migration).toContain("orders_fulfillment_failed_check");
    expect(migration).toContain('CREATE INDEX "orders_customer_created_idx"');
    expect(migration).toContain('CREATE INDEX "orders_states_idx"');
    expect(migration).not.toContain('CREATE TABLE "order_lines"');
    expect(migration).not.toContain("order_lines");
    expect(migration).not.toContain("reject_order_line_mutation");
    expect(migration).not.toContain("INSERT INTO");
    expect(migration).not.toContain("ON DELETE CASCADE");
    expect(migration).not.toContain("dotypos_reservation");
    expect(migration).not.toContain("customer_email");
    expect(migration).not.toContain("customer_name");
    expect(migration).not.toContain("customer_phone");
  });
});
