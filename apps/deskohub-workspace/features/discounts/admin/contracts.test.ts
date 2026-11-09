import { describe, expect, test } from "bun:test";
import {
  AdministrationDiscountDefinitionInput,
  AdministrationDiscountMutation,
  AdministrationExistingDiscountCodeCreateInput,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { workspaceCurrencyDefinitions } from "@/shared/money/currencies";

const decodeDiscount = Schema.decodeUnknownSync(
  AdministrationDiscountDefinitionInput,
  { errors: "all", onExcessProperty: "error" }
);
const decodeCode = Schema.decodeUnknownSync(
  AdministrationExistingDiscountCodeCreateInput,
  {
    errors: "all",
    onExcessProperty: "error",
  }
);
const decodeMutation = Schema.decodeUnknownSync(
  AdministrationDiscountMutation,
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
  products: [{ kind: "cowork" }],
};

const validCode = {
  discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  code: "SUMMER10",
  enabled: true,
  validFrom: "2026-08-01T00:00:00+02:00",
  validUntil: "2026-09-01T00:00:00+02:00",
  maxUses: 100,
  maxUsesPerCustomer: 2,
};

describe("discount administration inputs", () => {
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
        products: [{ kind: "cowork" }, { kind: "cowork" }],
      })
    ).toThrow();
    expect(() =>
      decodeDiscount({
        ...validDiscount,
        products: [{ kind: "cowork" }, { kind: "cowork", tier: "open-space" }],
      })
    ).toThrow();
  });

  test("accepts single cowork tier targets", () => {
    const products = [
      { kind: "cowork", tier: "open-space" },
      { kind: "cowork", tier: "reserved-desk" },
    ];
    expect(decodeDiscount({ ...validDiscount, products })).toMatchObject({
      products,
    });
  });

  test("accepts only catalog currencies with their defined exponent", () => {
    for (const { code, exponent } of workspaceCurrencyDefinitions) {
      expect(() =>
        decodeDiscount({
          ...validDiscount,
          adjustment: {
            kind: "fixed",
            amount: { value: 10_000, currency: code, exponent },
          },
        })
      ).not.toThrow();
    }
    expect(() =>
      decodeDiscount({
        ...validDiscount,
        adjustment: {
          kind: "fixed",
          amount: { value: 10_000, currency: "USD", exponent: 2 },
        },
      })
    ).toThrow();
    expect(() =>
      decodeDiscount({
        ...validDiscount,
        adjustment: {
          kind: "fixed",
          amount: { value: 10_000, currency: "CZK", exponent: 0 },
        },
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
    expect(() => decodeCode({ ...validCode, maxUsesPerCustomer: 0 })).toThrow();
    const { maxUsesPerCustomer: _, ...legacyCode } = validCode;
    expect(() => decodeCode(legacyCode)).not.toThrow();
  });

  test("creates discount codes and vouchers through separate mutations", () => {
    const code = {
      code: validCode.code,
      enabled: validCode.enabled,
      validFrom: validCode.validFrom,
      validUntil: validCode.validUntil,
      maxUses: validCode.maxUses,
    };

    expect(() =>
      decodeMutation({
        kind: "create-code",
        code,
        discount: { kind: "new", discount: validDiscount },
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "create-voucher",
        voucher: {
          code: code.code,
          enabled: code.enabled,
          validFrom: code.validFrom,
          validUntil: code.validUntil,
          credit: { value: 10_000, exponent: 2, currency: "CZK" },
        },
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "create-voucher",
        voucher: {
          code: code.code,
          enabled: code.enabled,
          validFrom: code.validFrom,
          validUntil: code.validUntil,
          credit: { value: 0, exponent: 2, currency: "CZK" },
        },
      })
    ).toThrow();
    expect(() =>
      decodeMutation({
        kind: "create-customer-code",
        customerId: "customer-id",
        code,
        discount: {
          kind: "existing",
          discountId: validCode.discountId,
        },
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "create-customer-code",
        customerId: "customer-id",
        code,
        discount: { kind: "new", discount: validDiscount },
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "create-customer-code",
        customerId: "customer-id",
        code,
        discount: { kind: "existing" },
      })
    ).toThrow();
  });
});
