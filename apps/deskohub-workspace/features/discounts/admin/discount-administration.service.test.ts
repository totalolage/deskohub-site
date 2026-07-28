import { describe, expect, test } from "bun:test";
import { getAdminDiscountCodeUsage } from "./discount-administration.service";

describe("discount administration read models", () => {
  test("counts reserved and redeemed claims against capacity but excludes releases", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 5,
        states: ["reserved", "redeemed", "released", "released"],
      })
    ).toEqual({
      reservedUses: 1,
      redeemedUses: 1,
      releasedUses: 2,
      remainingUses: 3,
    });
  });

  test("keeps unlimited capacity and floors exhausted codes at zero", () => {
    expect(
      getAdminDiscountCodeUsage({
        maxUses: null,
        states: ["redeemed"],
      }).remainingUses
    ).toBeNull();
    expect(
      getAdminDiscountCodeUsage({
        maxUses: 1,
        states: ["reserved", "redeemed"],
      }).remainingUses
    ).toBe(0);
  });
});
