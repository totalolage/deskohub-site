import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { workspaceProductTargets } from "@/features/discounts/product-target";
import {
  toCreateDiscountCodeInput,
  toCreateDiscountInput,
  toDiscountCodeConfigurationInput,
  toVoucherConfigurationInput,
  toVoucherCreditInput,
} from "./form-input";
import type {
  DiscountCodeFormValues,
  DiscountDefinitionFormValues,
  VoucherFormValues,
} from "./form-schemas";

const percentageDefinition = (
  overrides: Partial<DiscountDefinitionFormValues> = {}
): DiscountDefinitionFormValues => ({
  labelCs: "Letní sleva",
  labelEn: "Summer discount",
  adjustmentKind: "percentage",
  percentage: "10.25",
  fixedAmountValue: "10000",
  fixedAmountCurrency: "CZK",
  products: [],
  ...overrides,
});

describe("discount administration form input", () => {
  test("converts a percentage value to stored basis points", () => {
    expect(toCreateDiscountInput(percentageDefinition()).adjustment).toEqual({
      kind: "percentage",
      basisPoints: 1025,
    });
  });

  test("accepts every product offered by the catalog", () => {
    for (const identity of workspaceProductTargets) {
      expect(
        toCreateDiscountInput(
          percentageDefinition({ products: [identity.kind] })
        ).products
      ).toEqual([identity]);
    }
  });

  test("converts a fixed amount in a known catalog currency", () => {
    expect(
      toCreateDiscountInput(
        percentageDefinition({
          adjustmentKind: "fixed",
          fixedAmountValue: "10000",
          fixedAmountCurrency: "CZK",
        })
      ).adjustment
    ).toEqual({
      kind: "fixed",
      amount: { value: 10_000, exponent: 2, currency: "CZK" },
    });
  });

  test("marks an unknown fixed-amount currency as unsupported", () => {
    expect(
      toCreateDiscountInput(
        percentageDefinition({
          adjustmentKind: "fixed",
          fixedAmountValue: "2500",
          fixedAmountCurrency: "xyz",
        })
      ).adjustment
    ).toEqual({
      kind: "fixed",
      amount: { value: 2500, exponent: -1, currency: "" },
    });
  });

  test("converts local code times through the Workspace time zone", () => {
    const values: DiscountCodeFormValues = {
      discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
      code: "summer10",
      enabled: true,
      validFrom: "2026-08-01T10:00",
      validUntil: "2026-09-01T10:00",
      maxUses: "100",
      maxUsesPerCustomer: "2",
    };

    expect(toCreateDiscountCodeInput(values)).toEqual({
      discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
      code: "SUMMER10",
      enabled: true,
      validFrom: "2026-08-01T08:00:00Z",
      validUntil: "2026-09-01T08:00:00Z",
      maxUses: 100,
      maxUsesPerCustomer: 2,
    });
  });

  test("reads empty optional code fields as null", () => {
    expect(
      toDiscountCodeConfigurationInput({
        code: "summer10",
        enabled: false,
        validFrom: "",
        validUntil: "",
        maxUses: "",
        maxUsesPerCustomer: "",
      })
    ).toEqual({
      code: "SUMMER10",
      enabled: false,
      validFrom: null,
      validUntil: null,
      maxUses: null,
      maxUsesPerCustomer: null,
    });
  });

  test("reads voucher credit in the selected catalog currency", () => {
    expect(
      toVoucherCreditInput({ voucherValue: "10000", voucherCurrency: "czk" })
    ).toEqual({
      value: 10_000,
      exponent: 2,
      currency: "CZK",
    });
    expect(
      toVoucherCreditInput({ voucherValue: "5000", voucherCurrency: "zzz" })
    ).toEqual({ value: 5000, exponent: -1, currency: "" });
  });

  test("omits discount use limits from the voucher configuration", () => {
    const values: VoucherFormValues = {
      voucherValue: "10000",
      voucherCurrency: "CZK",
      code: "GIFT100",
      enabled: true,
      validFrom: "2026-08-01T10:00",
      validUntil: "",
      maxUses: "50",
      maxUsesPerCustomer: "3",
    };

    expect(toVoucherConfigurationInput(values)).toEqual({
      code: "GIFT100",
      enabled: true,
      validFrom: "2026-08-01T08:00:00Z",
      validUntil: null,
    });
    expect("maxUses" in toVoucherConfigurationInput(values)).toBe(false);
    expect("maxUsesPerCustomer" in toVoucherConfigurationInput(values)).toBe(
      false
    );
  });
});
