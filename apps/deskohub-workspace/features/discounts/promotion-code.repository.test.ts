import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  discountCodeIdSchema,
  promotionCodeIdSchema,
  voucherIdSchema,
} from "./persistence-contracts";
import {
  buildDiscountCodeAvailabilityQuery,
  buildPromotionAudienceQuery,
  buildVoucherAvailabilityQuery,
} from "./promotion-code.repository-query";

const promotionCodeId = promotionCodeIdSchema.make("promotion-1");
const codeId = discountCodeIdSchema.make("discount-code-1");
const voucherId = voucherIdSchema.make("voucher-1");

describe("promotion availability queries", () => {
  test("uses an empty shared audience as unrestricted", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildPromotionAudienceQuery({
      db,
      promotionCodeId,
      dotyposCustomerId: "customer-1",
    }).toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain(
      'coalesce(bool_or("dotypos_customer_id" = $1), false)'
    );
    expect(sql).toContain(
      'where "promotion_code_customers"."promotion_code_id" = $2'
    );
    expect(params).toEqual(["customer-1", promotionCodeId]);
  });

  test("counts unreleased ordinary claims", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildDiscountCodeAvailabilityQuery({
      db,
      codeId,
      dotyposCustomerId: "customer-1",
    }).toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain('"discount_code_redemptions"."state" in ($3, $4)');
    expect(sql).not.toContain("released");
    expect(params).toEqual(["customer-1", codeId, "reserved", "redeemed"]);
  });

  test("sums only reserved and redeemed voucher applications", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildVoucherAvailabilityQuery({
      db,
      voucherId,
      dotyposCustomerId: "customer-1",
    }).toSQL();

    expect(sql).toContain(
      'sum(coalesce("voucher_redemptions"."applied_amount_value", "discount_applications"."applied_amount_value"))'
    );
    expect(sql).toContain('"voucher_redemptions"."state" in ($3, $4)');
    expect(sql).not.toContain("released");
    expect(params).toEqual(["customer-1", voucherId, "reserved", "redeemed"]);
  });
});
