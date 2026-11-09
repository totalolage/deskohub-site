import { describe, expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  findDiscountAdminConflict,
  voucherDenominationCanChange,
} from "./discount-administration.service";

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
