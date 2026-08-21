import { describe, expect, test } from "bun:test";
import {
  findDiscountAdminConflict,
  getAdminDiscountCodeUsage,
  toAdminDiscountCodeClaim,
  toAdminVoucherClaim,
  voucherDenominationCanChange,
} from "./discount-administration.service";

describe("discount administration read models", () => {
  test("keeps issued goods claims visible without reservation payment facts", () => {
    const reservedAt = Temporal.Instant.from("2026-08-16T12:00:00Z");
    const application = {
      orderId: "goods-order-id",
      workspaceReservationId: null,
      appliedAmountValue: 3500,
      appliedAmountExponent: 2,
      appliedAmountCurrency: "CZK",
    };
    const claim = {
      dotyposCustomerId: "customer-id",
      state: "redeemed",
      paymentAttemptId: null,
      orderId: "goods-order-id",
      reservationExpiresAt: null,
      reservedAt,
      redeemedAt: reservedAt,
      releasedAt: null,
      releaseReason: null,
      application,
    } as never;

    expect(
      toAdminDiscountCodeClaim({
        ...claim,
        id: "discount-code-claim-id",
        codeId: "discount-code-id",
      })
    ).toEqual([
      expect.objectContaining({
        orderId: "goods-order-id",
        workspaceReservationId: null,
        paymentAttemptId: null,
        reservationExpiresAt: null,
      }),
    ]);
    expect(
      toAdminVoucherClaim({
        ...claim,
        id: "voucher-claim-id",
        voucherId: "voucher-id",
      })
    ).toEqual([
      expect.objectContaining({
        orderId: "goods-order-id",
        workspaceReservationId: null,
        paymentAttemptId: null,
        reservationExpiresAt: null,
      }),
    ]);
  });

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
  test("keeps voucher denomination immutable after released claim history", () => {
    expect(
      voucherDenominationCanChange({
        claimCount: 1,
        current: { exponent: 2, currency: "CZK" },
        updated: { exponent: 2, currency: "EUR" },
      })
    ).toBe(false);
    expect(
      voucherDenominationCanChange({
        claimCount: 0,
        current: { exponent: 2, currency: "CZK" },
        updated: { exponent: 2, currency: "EUR" },
      })
    ).toBe(true);
  });

  test("recognizes durable code and reference constraint failures", () => {
    expect(
      findDiscountAdminConflict({
        cause: {
          constraint: "promotion_codes_code_unique_idx",
        },
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "A promotion code with this value already exists.",
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
    expect(
      findDiscountAdminConflict({
        constraint: "discount_code_redemptions_code_id_discount_codes_id_fk",
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This discount code has claims and cannot be deleted.",
    });
    expect(
      findDiscountAdminConflict({
        constraint: "voucher_redemptions_voucher_id_vouchers_id_fkey",
      })
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This voucher has claims and cannot be deleted.",
    });
    expect(findDiscountAdminConflict(new Error("database unavailable"))).toBe(
      undefined
    );
  });
});
