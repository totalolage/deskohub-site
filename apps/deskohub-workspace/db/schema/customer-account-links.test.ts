import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { customerAccountLinks } from "./customer-account-links";

describe("customer account links", () => {
  test("stores only one opaque account-to-customer mapping", () => {
    const config = getTableConfig(customerAccountLinks);

    expect(
      config.columns.map(({ isUnique, name, notNull, primary }) => ({
        isUnique,
        name,
        notNull,
        primary,
      }))
    ).toEqual([
      {
        isUnique: false,
        name: "customer_account_id",
        notNull: true,
        primary: true,
      },
      {
        isUnique: true,
        name: "dotypos_customer_id",
        notNull: true,
        primary: false,
      },
    ]);
    expect(config.foreignKeys).toHaveLength(0);
  });

  test("migration is additive and contains no auth data or PII", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260821202645_customer_account_links/migration.sql",
        import.meta.url
      )
    ).text();
    const sql = migration.toLowerCase();

    expect(sql).toContain('create table "customer_account_links"');
    expect(sql).toContain('"customer_account_id" text primary key');
    expect(sql).toContain('"dotypos_customer_id" text not null unique');
    expect(sql).not.toContain("neon_auth");
    expect(sql).not.toContain("foreign key");
    expect(sql).not.toContain("drop ");
    expect(sql).not.toMatch(/\b(email|name|phone|address)\b/);
  });
});
