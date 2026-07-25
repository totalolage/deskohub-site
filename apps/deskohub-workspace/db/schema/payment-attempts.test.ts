import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { paymentAttempts, paymentProviders } from "./payment-attempts";
import { webhookProviders } from "./webhook-events";

describe("payment attempt providers", () => {
  test("separates internal payment attempts from Nexi-only webhooks", () => {
    expect(paymentProviders).toEqual(["nexi", "internal"]);
    expect(webhookProviders).toEqual(["nexi"]);
  });

  test("allows nullable external IDs behind provider-specific constraints", () => {
    const config = getTableConfig(paymentAttempts);
    const providerOrderId = config.columns.find(
      ({ name }) => name === "provider_order_id"
    );
    const checks = config.checks.map(({ name }) => name);
    const nexiOrderIndex = config.indexes.find(
      ({ config: index }) =>
        index.name === "payment_attempts_nexi_order_unique_idx"
    )?.config;

    expect(providerOrderId?.notNull).toBe(false);
    expect(checks).toEqual(
      expect.arrayContaining([
        "payment_attempts_provider_check",
        "payment_attempts_amount_check",
        "payment_attempts_provider_fields_check",
        "payment_attempts_internal_state_check",
      ])
    );
    expect(nexiOrderIndex).toMatchObject({
      unique: true,
    });
    expect(nexiOrderIndex?.where).toBeDefined();
  });

  test("generates the provider transition as one migration", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260724235932_living_sentry/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(
      'ALTER COLUMN "provider_order_id" DROP NOT NULL'
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "payment_attempts_nexi_order_unique_idx"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "payment_attempts_internal_state_check"'
    );
    expect(migration).toContain(
      'ADD CONSTRAINT "payment_attempts_amount_check" CHECK (("provider" = \'nexi\' and "amount_value" > 0) or ("provider" = \'internal\' and "amount_value" = 0)) NOT VALID'
    );
  });
});
