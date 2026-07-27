import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  createDiscountAdminInputSchema,
  createDiscountCodeAdminInputSchema,
} from "./contracts";

const decodeDiscount = Schema.decodeUnknownSync(
  createDiscountAdminInputSchema,
  { errors: "all", onExcessProperty: "error" }
);
const decodeCode = Schema.decodeUnknownSync(
  createDiscountCodeAdminInputSchema,
  {
    errors: "all",
    onExcessProperty: "error",
  }
);

const validDiscount = {
  labels: {
    "cs-CZ": "Letní sleva",
    "en-US": "Summer discount",
  },
  adjustment: {
    kind: "percentage",
    basisPoints: 1000,
  },
  products: [{ kind: "cowork", tier: "basic" }],
};

const validCode = {
  discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  code: "SUMMER10",
  enabled: true,
  validFrom: "2026-08-01T00:00:00+02:00",
  validUntil: "2026-09-01T00:00:00+02:00",
  maxUses: 100,
};

describe("discount administration inputs", () => {
  test("accepts a complete discount and code", () => {
    expect(() => decodeDiscount(validDiscount)).not.toThrow();
    expect(() => decodeCode(validCode)).not.toThrow();
  });

  test("requires complete labels and at least one unique target", () => {
    expect(() =>
      decodeDiscount({
        ...validDiscount,
        labels: { "en-US": "Summer discount" },
      })
    ).toThrow();
    expect(() => decodeDiscount({ ...validDiscount, products: [] })).toThrow();
    expect(() =>
      decodeDiscount({
        ...validDiscount,
        products: [
          { kind: "cowork", tier: "basic" },
          { kind: "cowork", tier: "basic" },
        ],
      })
    ).toThrow();
  });

  test("rejects noncanonical codes, invalid windows, and invalid capacity", () => {
    expect(() => decodeCode({ ...validCode, code: "summer10" })).toThrow();
    expect(() =>
      decodeCode({
        ...validCode,
        validUntil: validCode.validFrom,
      })
    ).toThrow();
    expect(() => decodeCode({ ...validCode, maxUses: 0 })).toThrow();
  });
});
