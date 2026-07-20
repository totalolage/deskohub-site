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
      at: Temporal.Instant.from("2026-07-15T12:00:00.000Z"),
    }).allowlist.toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain(
      'coalesce(bool_or("dotypos_customer_id" = $1), false)'
    );
    expect(sql).toContain('where "discount_code_customers"."code_id" = $2');
    expect(params).toEqual(["customer-1", codeId]);
  });

  test("counts redeemed and only live reserved claims", () => {
    const db = drizzle.mock({ schema });
    const at = Temporal.Instant.from("2026-07-15T12:00:00.000Z");
    const { sql, params } = buildDiscountCodeAvailabilityQueries({
      db,
      codeId,
      dotyposCustomerId: "customer-1",
      at,
    }).activeClaims.toSQL();

    expect(sql).toContain("count(*)");
    expect(sql).toContain(
      `coalesce(bool_or("dotypos_customer_id" = $1 and "state" = 'redeemed'), false)`
    );
    expect(sql).toContain('"state" = $3');
    expect(sql).toContain('"discount_code_redemptions"."state" = $4');
    expect(sql).toContain(
      '"discount_code_redemptions"."reservation_expires_at" > $5'
    );
    expect(sql).not.toContain("released");
    expect(params).toEqual([
      "customer-1",
      codeId,
      "redeemed",
      "reserved",
      "2026-07-15T12:00:00.000000Z",
    ]);
  });
});
