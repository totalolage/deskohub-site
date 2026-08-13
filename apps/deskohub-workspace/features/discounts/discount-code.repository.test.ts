import "@/shared/polyfills/temporal";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import { Schema } from "effect";
import * as schema from "@/db/schema";
import { buildDiscountCodeAvailabilityQueries } from "./discount-code.repository-query";
import { discountCodeIdSchema } from "./persistence-contracts";

const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82eda1"
);

describe("discount code availability queries", () => {
  test("uses an empty allowlist as unrestricted and detects the current customer", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildDiscountCodeAvailabilityQueries({
      db,
      codeId,
      dotyposCustomerId: "customer-1",
    }).allowlist.toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain(
      'coalesce(bool_or("dotypos_customer_id" = $1), false)'
    );
    expect(sql).toContain('where "discount_code_customers"."code_id" = $2');
    expect(params).toEqual(["customer-1", codeId]);
  });

  test("counts every unreleased claim and detects the current customer's state", () => {
    const db = drizzle.mock({ schema });
    const { sql, params } = buildDiscountCodeAvailabilityQueries({
      db,
      codeId,
      dotyposCustomerId: "customer-1",
    }).activeClaims.toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain(
      `coalesce(bool_or("discount_code_redemptions"."dotypos_customer_id" = $1 and "discount_code_redemptions"."state" = 'redeemed'), false)`
    );
    expect(sql).toContain(
      `coalesce(bool_or("discount_code_redemptions"."dotypos_customer_id" = $2 and "discount_code_redemptions"."state" = 'reserved'), false)`
    );
    expect(sql).toContain(
      'coalesce(sum("discount_applications"."applied_amount_value"), 0)::integer'
    );
    expect(sql).toContain('"discount_code_redemptions"."state" in ($4, $5)');
    expect(sql).not.toContain("reservation_expires_at");
    expect(sql).not.toContain("released");
    expect(params).toEqual([
      "customer-1",
      "customer-1",
      codeId,
      "reserved",
      "redeemed",
    ]);
  });
});
