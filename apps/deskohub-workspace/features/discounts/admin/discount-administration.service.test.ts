import { describe, expect, test } from "bun:test";
import type { Customer as DotyposCustomer } from "@deskohub/dotypos";
import { AdministrationCustomerSearchResult } from "@deskohub/workspace-admin-api";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  findDiscountAdminConflict,
  getAdminDiscountCodeUsage,
  toAdminDotyposCustomer,
  voucherDenominationCanChange,
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
    // Drizzle reports the Effect SQL failure inside a Cause; the Postgres
    // suite proves the same shape from real violations.
    const violation = (reason: SqlError.SqlErrorReason) =>
      new EffectDrizzleQueryError({
        query: "synthetic statement",
        params: [],
        cause: Cause.fail(new SqlError.SqlError({ reason })),
      });
    const pgError = (constraint: string) =>
      Object.assign(new Error("synthetic Postgres error"), { constraint });
    const foreignKeyViolation = (constraint: string) =>
      violation(new SqlError.ConstraintError({ cause: pgError(constraint) }));

    expect(
      findDiscountAdminConflict(
        violation(
          new SqlError.UniqueViolation({
            cause: pgError("promotion_codes_code_unique_idx"),
            constraint: "promotion_codes_code_unique_idx",
          })
        )
      )
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "A promotion code with this value already exists.",
    });
    expect(
      findDiscountAdminConflict(
        foreignKeyViolation("discount_codes_discount_id_discounts_id_fk")
      )
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message:
        "This discount is still referenced by a discount code and cannot be deleted.",
    });
    expect(
      findDiscountAdminConflict(
        foreignKeyViolation(
          "discount_code_redemptions_code_id_discount_codes_id_fk"
        )
      )
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This discount code has claims and cannot be deleted.",
    });
    expect(
      findDiscountAdminConflict(
        foreignKeyViolation("voucher_redemptions_voucher_id_vouchers_id_fkey")
      )
    ).toMatchObject({
      _tag: "DiscountAdminConflictError",
      message: "This voucher has claims and cannot be deleted.",
    });
    expect(findDiscountAdminConflict(foreignKeyViolation("unrelated_fk"))).toBe(
      undefined
    );
    expect(
      findDiscountAdminConflict(
        violation(
          new SqlError.ConnectionError({ cause: new Error("unavailable") })
        )
      )
    ).toBe(undefined);
  });
});

describe("discount administration customers", () => {
  const unnamed = { id: "dotypos-customer" } as DotyposCustomer;

  test("signals a customer without a name or contact detail", () => {
    expect(toAdminDotyposCustomer(unnamed)).toMatchObject({
      displayName: "Unnamed customer",
      hasName: false,
    });
    expect(
      toAdminDotyposCustomer({ ...unnamed, phone: " +420 123 456 789 " })
    ).toMatchObject({ displayName: "+420 123 456 789", hasName: true });
  });

  test("keeps the administration API customer shape unchanged", () => {
    const encoded = Schema.encodeSync(AdministrationCustomerSearchResult)({
      kind: "matched",
      customers: [toAdminDotyposCustomer(unnamed)],
    });

    expect(encoded.customers[0]).toEqual({
      id: "dotypos-customer",
      displayName: "Unnamed customer",
      email: null,
      phone: null,
      discountGroupId: null,
    });
  });
});
