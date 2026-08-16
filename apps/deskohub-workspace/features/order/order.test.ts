import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  orderFulfillmentStates,
  orderIdSchema,
  orderKinds,
  orderLineIdSchema,
  orderPaymentStates,
} from "./order";

describe("order domain", () => {
  test("defines only the shared order and lifecycle discriminators", () => {
    expect(orderKinds).toEqual(["reservation", "goods"]);
    expect(orderPaymentStates).toEqual([
      "not_started",
      "pending",
      "paid",
      "failed",
      "cancelled",
      "expired",
    ]);
    expect(orderFulfillmentStates).toEqual([
      "not_started",
      "processing",
      "fulfilled",
      "failed",
    ]);
  });

  test("rejects empty persisted identifiers", () => {
    const decodeOrderId = Schema.decodeUnknownSync(orderIdSchema);
    const decodeOrderLineId = Schema.decodeUnknownSync(orderLineIdSchema);

    expect(() => decodeOrderId("")).toThrow();
    expect(() => decodeOrderLineId("")).toThrow();
    expect(decodeOrderId("order-id")).toBe("order-id");
    expect(decodeOrderLineId("line-id")).toBe("line-id");
  });
});
