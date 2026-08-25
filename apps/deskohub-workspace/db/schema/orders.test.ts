import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orderLines, orders } from "./orders";

const migrationUrl = new URL(
  "../migrations/20260821204948_order_architecture_foundation/migration.sql",
  import.meta.url
);

describe("generic orders", () => {
  test("stores generic lifecycle and immutable line price facts", () => {
    const orderConfig = getTableConfig(orders);
    const lineConfig = getTableConfig(orderLines);

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
    expect(lineConfig.columns.map(({ name }) => name)).toEqual([
      "id",
      "order_id",
      "sequence",
      "product_identity",
      "description",
      "quantity",
      "unit_price_value",
      "undiscounted_total_value",
      "payable_total_value",
      "amount_exponent",
      "currency",
      "created_at",
    ]);
    expect(lineConfig.foreignKeys).toHaveLength(1);
    expect(lineConfig.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "order_lines_quantity_check",
        "order_lines_product_identity_check",
        "order_lines_money_check",
        "order_lines_amount_exponent_check",
        "order_lines_currency_check",
      ])
    );
  });

  test("keeps generic tables dormant until reservation writers migrate", async () => {
    const migration = await Bun.file(migrationUrl).text();

    expect(migration).toContain('CREATE TABLE "orders"');
    expect(migration).toContain('CREATE TABLE "order_lines"');
    expect(migration).not.toContain('INSERT INTO "orders"');
    expect(migration).not.toContain('FROM "workspace_reservations"');
    expect(migration).toContain("order_lines_immutable");
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "order_lines"');
    expect(migration).not.toContain("ON DELETE CASCADE");
    expect(migration).toContain('CHECK ("amount_exponent" = 2)');
    expect(migration).toContain(`CHECK ("currency" = 'CZK')`);
    expect(migration).not.toContain('INSERT INTO "order_lines"');
    expect(migration).not.toContain("dotypos_reservation");
    expect(migration).not.toContain("customer_email");
    expect(migration).not.toContain("customer_name");
    expect(migration).not.toContain("customer_phone");
  });
});
