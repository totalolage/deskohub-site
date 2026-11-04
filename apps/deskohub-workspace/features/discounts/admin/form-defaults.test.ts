import { describe, expect, test } from "bun:test";
import type {
  DiscountCodeId,
  StoredDiscountId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import { defaultWorkspaceCurrencyCode } from "@/shared/money/currencies";
import type {
  DiscountCodeTableItem,
  DiscountTableItem,
  VoucherTableItem,
} from "./admin-tables";
import {
  discountCodeFormDefaults,
  discountDefinitionFormDefaults,
  voucherFormDefaults,
} from "./form-defaults";

const discountId = "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId;

const percentageDiscount: DiscountTableItem = {
  id: discountId,
  labels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
  adjustment: { kind: "percentage", basisPoints: 1250 },
  products: [{ kind: "cowork", tier: "reserved-desk" }, { kind: "booking" }],
  codeCount: 1,
};

const code: DiscountCodeTableItem = {
  id: "019c91dd-c560-7e55-b9d8-c95065efd52d" as DiscountCodeId,
  discountId,
  code: "SUMMER10",
  enabled: false,
  validFrom: "2026-08-01T08:00:00Z",
  validUntil: "2026-12-01T08:00:00Z",
  maxUses: 0,
  maxUsesPerCustomer: 2,
  audienceSize: 0,
  reservedUses: 0,
  redeemedUses: 0,
  remainingUses: 0,
};

const voucher: VoucherTableItem = {
  id: "019c91dd-c560-7e55-b9d8-c95065efd55d" as VoucherId,
  code: "GIFT100",
  issuedCredit: { value: 25_000, exponent: 2, currency: "EUR" },
  remainingCredit: { value: 5000, exponent: 2, currency: "EUR" },
  enabled: false,
  validFrom: null,
  validUntil: "2026-08-01T08:00:00Z",
  audienceSize: 0,
  reservedUses: 0,
  redeemedUses: 0,
};

describe("discountDefinitionFormDefaults", () => {
  test("starts a new discount at ten percent in the default currency", () => {
    expect(discountDefinitionFormDefaults()).toEqual({
      labelEn: "",
      labelCs: "",
      adjustmentKind: "percentage",
      percentage: "10",
      fixedAmountValue: "10000",
      fixedAmountCurrency: defaultWorkspaceCurrencyCode,
      products: [],
    });
  });

  test("edits a percentage discount in percent with its product keys", () => {
    expect(discountDefinitionFormDefaults(percentageDiscount)).toEqual({
      labelEn: "Summer discount",
      labelCs: "Letní sleva",
      adjustmentKind: "percentage",
      percentage: "12.5",
      fixedAmountValue: "10000",
      fixedAmountCurrency: defaultWorkspaceCurrencyCode,
      products: ["cowork:reserved-desk", "booking"],
    });
  });

  test("edits a fixed discount in its minor units and currency", () => {
    expect(
      discountDefinitionFormDefaults({
        ...percentageDiscount,
        adjustment: {
          kind: "fixed",
          amount: { value: 5000, exponent: 2, currency: "EUR" },
        },
      })
    ).toMatchObject({
      adjustmentKind: "fixed",
      percentage: "10",
      fixedAmountValue: "5000",
      fixedAmountCurrency: "EUR",
    });
  });
});

describe("discountCodeFormDefaults", () => {
  test("starts a new code enabled, open-ended and unlimited", () => {
    expect(discountCodeFormDefaults()).toEqual({
      discountId: "",
      code: "",
      enabled: true,
      validFrom: "",
      validUntil: "",
      maxUses: "",
      maxUsesPerCustomer: "",
    });
  });

  test("edits a code's window in Prague time and keeps a zero limit", () => {
    expect(discountCodeFormDefaults(code)).toEqual({
      discountId,
      code: "SUMMER10",
      enabled: false,
      validFrom: "2026-08-01T10:00",
      validUntil: "2026-12-01T09:00",
      maxUses: "0",
      maxUsesPerCustomer: "2",
    });
  });

  test("leaves unlimited usage empty", () => {
    expect(
      discountCodeFormDefaults({
        ...code,
        maxUses: null,
        maxUsesPerCustomer: null,
      })
    ).toMatchObject({ maxUses: "", maxUsesPerCustomer: "" });
  });
});

describe("voucherFormDefaults", () => {
  test("starts a new voucher at one hundred in the default currency", () => {
    expect(voucherFormDefaults()).toEqual({
      voucherValue: "10000",
      voucherCurrency: defaultWorkspaceCurrencyCode,
      code: "",
      enabled: true,
      validFrom: "",
      validUntil: "",
    });
  });

  test("edits a voucher's issued credit and window", () => {
    expect(voucherFormDefaults(voucher)).toEqual({
      voucherValue: "25000",
      voucherCurrency: "EUR",
      code: "GIFT100",
      enabled: false,
      validFrom: "",
      validUntil: "2026-08-01T10:00",
    });
  });
});
