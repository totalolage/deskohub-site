import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import "@/shared/polyfills/temporal";
import {
  toCreateDiscountCodeInput,
  toCreateDiscountInput,
  toVoucherCreditInput,
} from "./form-input";
import type {
  DiscountCodeFormValues,
  DiscountDefinitionFormValues,
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

const createdDiscount = (values: DiscountDefinitionFormValues) =>
  Option.getOrThrow(toCreateDiscountInput(values));

describe("discount administration form input", () => {
  test("converts a percentage value to stored basis points", () => {
    expect(createdDiscount(percentageDefinition()).adjustment).toEqual({
      kind: "percentage",
      basisPoints: 1025,
    });
  });

  test("ignores the inactive fixed-amount currency of a percentage discount", () => {
    expect(
      createdDiscount(percentageDefinition({ fixedAmountCurrency: "ZZZ" }))
        .adjustment
    ).toEqual({ kind: "percentage", basisPoints: 1025 });
  });

  test("maps cowork tier keys to tier targets", () => {
    expect(
      createdDiscount(
        percentageDefinition({
          products: ["office", "cowork:reserved-desk", "cowork:open-space"],
        })
      ).products
    ).toEqual([
      { kind: "cowork", tier: "open-space" },
      { kind: "cowork", tier: "reserved-desk" },
      { kind: "office" },
    ]);
  });

  test("keeps the broad cowork key as the target covering every tier", () => {
    expect(
      createdDiscount(percentageDefinition({ products: ["cowork"] })).products
    ).toEqual([{ kind: "cowork" }]);
  });

  test("converts a fixed amount in a known catalog currency", () => {
    expect(
      createdDiscount(
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

  test("forms no discount for a fixed amount outside the catalog", () => {
    expect(
      Option.isNone(
        toCreateDiscountInput(
          percentageDefinition({
            adjustmentKind: "fixed",
            fixedAmountCurrency: "ZZZ",
          })
        )
      )
    ).toBe(true);
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

  test("reads voucher credit in the selected catalog currency", () => {
    expect(
      toVoucherCreditInput({ voucherValue: "10000", voucherCurrency: "czk" })
    ).toEqual(Option.some({ value: 10_000, exponent: 2, currency: "CZK" }));
    expect(
      Option.isNone(
        toVoucherCreditInput({ voucherValue: "5000", voucherCurrency: "zzz" })
      )
    ).toBe(true);
  });
});
