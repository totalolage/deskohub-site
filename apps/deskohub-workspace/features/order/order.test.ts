import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  orderFulfillmentStates,
  orderIdSchema,
  orderKindSchema,
  orderKinds,
  orderPaymentStates,
} from "./order";

describe("order domain", () => {
  test("defines exactly the reservation-only kind", () => {
    expect(orderKinds).toEqual(["reservation"]);
  });

  test("defines exactly the six payment states of the reservation domain", () => {
    expect(orderPaymentStates).toEqual([
      "not_started",
      "pending",
      "paid",
      "failed",
      "cancelled",
      "expired",
    ]);
  });

  test("defines exactly the five fulfillment states incl. awaiting delivery", () => {
    expect(orderFulfillmentStates).toEqual([
      "not_started",
      "processing",
      "awaiting_delivery",
      "fulfilled",
      "failed",
    ]);
  });

  test("decodes only the mandated lifecycle values through the schemas", () => {
    const decodeKind = Schema.decodeUnknownSync(orderKindSchema);

    expect(decodeKind("reservation")).toBe("reservation");
    expect(() => decodeKind("goods")).toThrow();
    expect(() => decodeKind("")).toThrow();
  });

  test("branded order id decodes uuids and rejects everything else", () => {
    const decodeOrderId = Schema.decodeUnknownSync(orderIdSchema);
    const encodeOrderId = Schema.encodeSync(orderIdSchema);
    const orderId = decodeOrderId("0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f");

    expect(encodeOrderId(orderId)).toBe("0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f");
    expect(() => decodeOrderId("order-id")).toThrow();
    expect(() => decodeOrderId("")).toThrow();
    expect(() => decodeOrderId(42)).toThrow();
  });
});
