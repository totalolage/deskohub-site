import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { workspaceCurrencyDefinitions } from "@/shared/money/currencies";
import {
  createDiscountAdminInputSchema,
  createDiscountCodeAdminInputSchema,
  discountAdminCustomerSearchSchema,
  discountAdminMutationSchema,
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
const decodeMutation = Schema.decodeUnknownSync(discountAdminMutationSchema, {
  errors: "all",
  onExcessProperty: "error",
});
const decodeCustomerSearch = Schema.decodeUnknownSync(
  discountAdminCustomerSearchSchema,
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
        products: [{ kind: "cowork" }, { kind: "cowork" }],
      })
    ).toThrow();
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
  });

  test("accepts audience and Dotypos group operations but no claim mutations", () => {
    expect(() =>
      decodeMutation({
        kind: "add-code-customer",
        codeId: "code-id",
        customerId: "customer-id",
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "make-code-unrestricted",
        codeId: "code-id",
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "set-customer-discount-group",
        customerId: "customer-id",
        discountGroupId: null,
      })
    ).not.toThrow();
    expect(() =>
      decodeMutation({
        kind: "release-code-claim",
        claimId: "claim-id",
      })
    ).toThrow();
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

  test("accepts a bounded fuzzy customer query", () => {
    expect(() => decodeCustomerSearch({ query: "Ada" })).not.toThrow();
    expect(() => decodeCustomerSearch({ query: "a" })).toThrow();
    expect(() =>
      decodeCustomerSearch({ query: "Ada;deleted|eq|true" })
    ).toThrow();
    expect(() =>
      decodeCustomerSearch({ query: "Ada", customerId: "customer-id" })
    ).toThrow();
  });
});
