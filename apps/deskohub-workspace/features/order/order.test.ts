import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { orderIdSchema, orderKindSchema } from ".";

describe("order domain", () => {
  test("decodes reservation as the only order kind", () => {
    const decodeKind = Schema.decodeUnknownSync(orderKindSchema);

    expect(decodeKind("reservation")).toBe("reservation");
    expect(() => decodeKind("goods")).toThrow();
    expect(() => decodeKind("")).toThrow();
  });

  test("decodes uuid order ids and rejects anything else", () => {
    const decodeOrderId = Schema.decodeUnknownSync(orderIdSchema);
    const encodeOrderId = Schema.encodeSync(orderIdSchema);
    const orderId = decodeOrderId("0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f");

    expect(encodeOrderId(orderId)).toBe("0198c1a2-3b4c-7d5e-8f90-1a2b3c4d5e6f");
    expect(() => decodeOrderId("order-id")).toThrow();
    expect(() => decodeOrderId("")).toThrow();
    expect(() => decodeOrderId(42)).toThrow();
  });
});
