import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { customerMarketingConsents } from "./customer-marketing-consents";

describe("customer marketing consent persistence", () => {
  test("stores one minimal consent record per Dotypos customer", () => {
    const config = getTableConfig(customerMarketingConsents);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );

    expect(config.columns.map(({ name }) => name)).toEqual([
      "dotypos_customer_id",
      "document_hash",
      "locale",
      "granted_at",
      "withdrawn_at",
    ]);
    expect(columns.dotypos_customer_id?.primary).toBe(true);
    expect(columns.dotypos_customer_id?.notNull).toBe(true);
    expect(columns.document_hash?.notNull).toBe(true);
    expect(columns.locale?.notNull).toBe(true);
    expect(columns.granted_at?.notNull).toBe(true);
    expect(columns.withdrawn_at?.notNull).toBe(false);
    expect(config.foreignKeys).toHaveLength(0);
    expect(config.indexes).toHaveLength(0);
    expect(config.checks.map(({ name }) => name)).toEqual([
      "customer_marketing_consents_customer_check",
      "customer_marketing_consents_locale_check",
      "customer_marketing_consents_withdrawal_check",
    ]);
  });

  test("only reactivates a previously withdrawn consent", async () => {
    const source = await Bun.file(
      new URL(
        "../../features/legal/backend/customer-marketing-consent.repository.ts",
        import.meta.url
      )
    ).text();

    expect(source).toContain(
      "target: customerMarketingConsents.dotyposCustomerId"
    );
    expect(source).toContain(
      "setWhere: isNotNull(customerMarketingConsents.withdrawnAt)"
    );
    expect(source).toContain("withdrawnAt: null");
    expect(source).not.toContain("onConflictDoNothing");
  });

  test("creates the customer table without a historical backfill", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260810091934_ordinary_odin/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('CREATE TABLE "customer_marketing_consents"');
    expect(migration).toContain('"dotypos_customer_id" text PRIMARY KEY');
    expect(migration).not.toContain("INSERT INTO");
    expect(migration).not.toContain("legal_evidence_events");
  });
});
