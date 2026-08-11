import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { customerAccountLinks } from "./customer-account-links";

describe("customer account link persistence", () => {
  test("stores only opaque identity links with one-to-one uniqueness", () => {
    const config = getTableConfig(customerAccountLinks);

    expect(config.name).toBe("customer_account_links");
    expect(config.columns.map(({ name }) => name)).toEqual([
      "customer_account_id",
      "dotypos_customer_id",
      "created_at",
      "updated_at",
    ]);
    expect(config.primaryKeys).toHaveLength(0);
    expect(
      config.columns.find(({ name }) => name === "customer_account_id")?.primary
    ).toBe(true);
    expect(
      config.columns.find(({ name }) => name === "dotypos_customer_id")
        ?.isUnique
    ).toBe(true);
    expect(config.foreignKeys).toHaveLength(0);
  });

  test("generated migration is additive and contains no customer PII", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260811193101_customer_accounts/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('CREATE TABLE "customer_account_links"');
    expect(migration).toContain('"customer_account_id" text PRIMARY KEY');
    expect(migration).toContain('"dotypos_customer_id" text NOT NULL UNIQUE');
    expect(migration).not.toContain("discount_targets");
    expect(migration).not.toContain("DROP TABLE");
    expect(migration).not.toContain('"email"');
    expect(migration).not.toContain('"name"');
    expect(migration).not.toContain("neon_auth");
  });
});
