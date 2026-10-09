import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  orderFulfillmentStates,
  orderKinds,
  orderPaymentStates,
} from "@/features/order";
import { orders } from "./orders";

const dialect = new PgDialect();

const checkSql = (name: string): string => {
  const check = getTableConfig(orders).checks.find(
    ({ name: checkName }) => checkName === name
  );
  expect(check).toBeDefined();
  return dialect.sqlToQuery(check!.value).sql;
};

const quotedValues = (checkName: string): string[] =>
  [...checkSql(checkName).matchAll(/'([^']*)'/g)].map(([, value]) => value);

describe("orders", () => {
  test("rejects any kind outside the reservation-only vocabulary", () => {
    const kindValues = quotedValues("orders_kind_check");
    expect(checkSql("orders_kind_check")).toMatch(/\bin\b/);
    expect(kindValues).toEqual([...orderKinds]);
    expect(kindValues).not.toContain("goods");
  });

  test("rejects lifecycle values outside the shared state vocabularies", () => {
    expect(quotedValues("orders_payment_state_check")).toEqual([
      ...orderPaymentStates,
    ]);
    expect(quotedValues("orders_fulfillment_state_check")).toEqual([
      ...orderFulfillmentStates,
    ]);
    expect(quotedValues("orders_fulfillment_state_check")).toContain(
      "awaiting_delivery"
    );
  });

  test("requires paid_at once payment is paid", () => {
    const sql = checkSql("orders_paid_at_check");
    expect(sql).toContain("<> 'paid'");
    expect(sql).toContain('"paid_at" is not null');
  });

  test("requires fulfilled_at once fulfillment is fulfilled", () => {
    const sql = checkSql("orders_fulfilled_check");
    expect(sql).toContain("<> 'fulfilled'");
    expect(sql).toContain('"fulfilled_at" is not null');
  });

  test("requires failure facts once fulfillment failed", () => {
    const sql = checkSql("orders_fulfillment_failed_check");
    expect(sql).toContain("<> 'failed'");
    expect(sql).toContain('"fulfillment_failed_at" is not null');
    expect(sql).toContain('"fulfillment_failure_code" is not null');
  });

  test("mirrors the active payment attempt without owning its lifecycle", () => {
    const config = getTableConfig(orders);
    const activePaymentAttemptId = config.columns.find(
      ({ name }) => name === "active_payment_attempt_id"
    );

    expect(activePaymentAttemptId?.notNull).toBe(false);
  });

  test("enforces the required customer and correlation facts", () => {
    const config = getTableConfig(orders);
    const correlationId = config.columns.find(
      ({ name }) => name === "correlation_id"
    );
    const dotyposCustomerId = config.columns.find(
      ({ name }) => name === "dotypos_customer_id"
    );

    expect(correlationId?.notNull).toBe(true);
    expect(dotyposCustomerId?.notNull).toBe(true);
    expect(checkSql("orders_dotypos_customer_id_check")).toContain("btrim");
    expect(checkSql("orders_dotypos_customer_id_check")).toContain("<> ''");
  });
});
