import { describe, expect, test } from "bun:test";
import {
  applyWorkspaceCustomerDiscount,
  getDotyposCustomerDiscount,
} from "./checkout-pricing";

const price = { value: 35_000, exponent: 2, currency: "CZK" };

describe("workspace checkout customer discounts", () => {
  test("uses the Dotypos customer discount group value as percent", () => {
    expect(getDotyposCustomerDiscount({ _discountGroupId: "5" })).toEqual({
      source: "dotypos-customer",
      field: "_discountGroupId",
      percent: 5,
    });
  });

  test("prefers explicit discount percent fields over the discount group id", () => {
    expect(
      getDotyposCustomerDiscount({
        _discountGroupId: "20",
        discountPercent: "5",
      })
    ).toEqual({
      source: "dotypos-customer",
      field: "discountPercent",
      percent: 5,
    });
  });

  test("applies customer percent discount and stores discount amount", () => {
    const checkoutPrice = applyWorkspaceCustomerDiscount(price, {
      _discountGroupId: "5",
    });

    expect(checkoutPrice).toEqual({
      expectedPrice: { value: 33_250, exponent: 2, currency: "CZK" },
      customerDiscount: {
        source: "dotypos-customer",
        field: "_discountGroupId",
        percent: 5,
        amount: { value: 1750, exponent: 2, currency: "CZK" },
      },
    });
  });

  test("rounds fractional minor-unit discounts to the nearest unit", () => {
    const checkoutPrice = applyWorkspaceCustomerDiscount(
      { value: 100, exponent: 2, currency: "CZK" },
      { _discountGroupId: "12.5" }
    );

    expect(checkoutPrice.expectedPrice.value).toBe(87);
    expect(checkoutPrice.customerDiscount?.amount.value).toBe(13);
  });

  test("leaves the price unchanged when no valid Dotypos discount is present", () => {
    expect(getDotyposCustomerDiscount({ _discountGroupId: null })).toBe(
      undefined
    );
    expect(applyWorkspaceCustomerDiscount(price, {})).toEqual({
      expectedPrice: price,
    });
  });
});
