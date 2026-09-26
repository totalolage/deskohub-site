import { describe, expect, test } from "bun:test";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { NexiCorrelationId } from "@deskohub/nexi";
import { Temporal } from "@js-temporal/polyfill";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  type OrderId,
  orderFulfillmentStates,
  orderKinds,
  orderPaymentStates,
} from "@/features/order";
import { type NewOrder, type Order, orders } from "./orders";

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

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// The order row carries branded domain identities, not bare strings.
type _OrderIdIsBranded = Expect<Equal<Order["id"], OrderId>>;
type _InsertIdIsBranded = Expect<OrderId extends NewOrder["id"] ? true : false>;
type _CorrelationIdIsBranded = Expect<
  Equal<Order["correlationId"], NexiCorrelationId>
>;
type _CustomerIdIsBranded = Expect<
  Equal<Order["dotyposCustomerId"], DotyposCustomerId>
>;

// Insert-time facts without defaults must be supplied by the caller.
type _KindIsRequired = Expect<
  Equal<Pick<NewOrder, "kind">, { kind: Order["kind"] }>
>;
type _PaymentStateIsRequired = Expect<
  Equal<Pick<NewOrder, "paymentState">, { paymentState: Order["paymentState"] }>
>;
type _FulfillmentStateIsRequired = Expect<
  Equal<
    Pick<NewOrder, "fulfillmentState">,
    { fulfillmentState: Order["fulfillmentState"] }
  >
>;
type _CustomerIdIsRequired = Expect<
  Equal<
    Pick<NewOrder, "dotyposCustomerId">,
    { dotyposCustomerId: Order["dotyposCustomerId"] }
  >
>;

describe("orders", () => {
  test("accepts a valid reservation order against the schema types", () => {
    const insert: NewOrder = {
      kind: "reservation",
      correlationId:
        "0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f" as NexiCorrelationId,
      dotyposCustomerId: "12345" as DotyposCustomerId,
      paymentState: "paid",
      fulfillmentState: "processing",
      paidAt: Temporal.Instant.from("2026-09-26T10:00:00.000Z"),
    };
    expect(insert.kind).toBe("reservation");
    expect(insert.paymentState).toBe("paid");

    const select: Order = {
      id: "0198c1a2-3b4c-7d5e-8f90-6f5e4d3c2b1a" as OrderId,
      kind: "reservation",
      correlationId:
        "0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f" as NexiCorrelationId,
      dotyposCustomerId: "12345" as DotyposCustomerId,
      paymentState: "paid",
      fulfillmentState: "fulfilled",
      paidAt: Temporal.Instant.from("2026-09-26T10:00:00.000Z"),
      fulfilledAt: Temporal.Instant.from("2026-09-26T11:00:00.000Z"),
      fulfillmentFailedAt: null,
      fulfillmentFailureCode: null,
      createdAt: Temporal.Instant.from("2026-09-26T09:00:00.000Z"),
      updatedAt: Temporal.Instant.from("2026-09-26T11:00:00.000Z"),
    };
    expect(select.fulfillmentState).toBe("fulfilled");

    // @ts-expect-error only the reservation kind is a valid order kind
    const invalidKind: NewOrder = {
      kind: "goods",
      dotyposCustomerId: "12345" as DotyposCustomerId,
      paymentState: "paid",
      fulfillmentState: "processing",
    };
    expect(invalidKind.kind).toBe("goods");
  });

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
