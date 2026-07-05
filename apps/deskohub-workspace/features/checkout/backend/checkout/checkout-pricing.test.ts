import { describe, expect, test } from "bun:test";
import { applyWorkspaceCustomerDiscount } from "./checkout-pricing";

const price = { value: 35_000, exponent: 2, currency: "CZK" };

describe("workspace checkout customer discounts", () => {
  test("applies customer percent discount and stores discount amount", () => {
    const checkoutPrice = applyWorkspaceCustomerDiscount(price, {
      source: "dotypos-discount-group",
      discountGroupId: "5",
      percent: 5,
    });

    expect(checkoutPrice).toEqual({
      expectedPrice: { value: 33_250, exponent: 2, currency: "CZK" },
      customerDiscount: {
        source: "dotypos-discount-group",
        discountGroupId: "5",
        percent: 5,
        amount: { value: 1750, exponent: 2, currency: "CZK" },
      },
    });
  });

  test("rounds fractional minor-unit discounts to the nearest unit", () => {
    const checkoutPrice = applyWorkspaceCustomerDiscount(
      { value: 100, exponent: 2, currency: "CZK" },
      {
        source: "dotypos-discount-group",
        discountGroupId: "12.5",
        percent: 12.5,
      }
    );

    expect(checkoutPrice.expectedPrice.value).toBe(87);
    expect(checkoutPrice.customerDiscount?.amount.value).toBe(13);
  });

  test("leaves the price unchanged when no valid Dotypos discount is present", () => {
    expect(applyWorkspaceCustomerDiscount(price, undefined)).toEqual({
      expectedPrice: price,
    });
  });
});
