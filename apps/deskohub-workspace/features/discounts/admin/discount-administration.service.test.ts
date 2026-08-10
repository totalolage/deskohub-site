import { describe, expect, test } from "bun:test";
import {
  findDiscountAdminConflict,
  getAdminDiscountCodeUsage,
} from "./discount-administration.service";

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

describe("discount administration conflicts", () => {
  test("recognizes durable code and reference constraint failures", () => {
    expect(
      findDiscountAdminConflict({
        cause: {
          constraint: "discount_codes_code_unique_idx",
        },
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "A discount code with this value already exists.",
    });
    expect(
      findDiscountAdminConflict({
        reason: {
          cause: {
            constraint: "discount_codes_discount_id_discounts_id_fk",
          },
        },
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message:
        "This discount is still referenced by a discount code and cannot be deleted.",
    });
    expect(findDiscountAdminConflict(new Error("database unavailable"))).toBe(
      undefined
    );
  });
});
