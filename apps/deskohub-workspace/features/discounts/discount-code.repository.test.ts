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

  test("counts every active claim globally and for the current customer", () => {
    const db = drizzle.mock({ schema });
    const queries = buildDiscountCodeAvailabilityQueries({
      db,
      codeId,
      dotyposCustomerId: "customer-1",
    });
    const activeClaims = queries.activeClaims.toSQL();
    const customerActiveClaims = queries.customerActiveClaims.toSQL();

    expect(activeClaims.sql).toContain("count(*)");
    expect(activeClaims.sql).toContain(
      '"discount_code_redemptions"."state" in ($2, $3)'
    );
    expect(activeClaims.params).toEqual([codeId, "reserved", "redeemed"]);
    expect(customerActiveClaims.sql).toContain("count(*)");
    expect(customerActiveClaims.sql).toContain(
      '"discount_code_redemptions"."dotypos_customer_id" = $2'
    );
    expect(customerActiveClaims.params).toEqual([
      codeId,
      "customer-1",
      "reserved",
      "redeemed",
    ]);
    expect(customerActiveClaims.sql).not.toContain("reservation_expires_at");
    expect(customerActiveClaims.sql).not.toContain("released");
  });
});
