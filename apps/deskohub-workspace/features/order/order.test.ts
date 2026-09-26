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
  test("defines the reservation-only kind and shared lifecycle vocabularies", () => {
    expect(orderKinds).toEqual(["reservation"]);
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
      "awaiting_delivery",
      "fulfilled",
      "failed",
    ]);
  });

  test("represents every mandated lifecycle value through the schemas", () => {
    const decodeKind = Schema.decodeUnknownSync(orderKindSchema);

    expect(decodeKind("reservation")).toBe("reservation");
    expect(() => decodeKind("goods")).toThrow();
    expect(() => decodeKind("")).toThrow();

    for (const state of orderPaymentStates) {
      expect(orderPaymentStates).toContain(state);
    }
    for (const state of orderFulfillmentStates) {
      expect(orderFulfillmentStates).toContain(state);
    }
    expect(orderFulfillmentStates).toContain("awaiting_delivery");
  });

  test("rejects empty persisted identifiers", () => {
    const decodeOrderId = Schema.decodeUnknownSync(orderIdSchema);

    expect(() => decodeOrderId("")).toThrow();
    expect(decodeOrderId("order-id")).toBe("order-id");
  });

  test("carries no personally identifying or sensitive fields", () => {
    const vocabularyJson = JSON.stringify([
      ...orderKinds,
      ...orderPaymentStates,
      ...orderFulfillmentStates,
    ]);

    expect(vocabularyJson).not.toMatch(
      /email|phone|customer_name|token|password/i
    );
    expect(Object.keys(orderKinds)).not.toContain("goods");
  });
});
