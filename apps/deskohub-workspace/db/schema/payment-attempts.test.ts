import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  paymentAttempts,
  paymentProviders,
  paymentRefundStates,
} from "./payment-attempts";
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

  test("tracks required refunds separately from successful payment", () => {
    const config = getTableConfig(paymentAttempts);
    const refundState = config.columns.find(
      ({ name }) => name === "refund_state"
    );

    expect(paymentRefundStates).toEqual([
      "not_required",
      "required",
      "refunded",
    ]);
    expect(refundState).toMatchObject({ hasDefault: true, notNull: true });
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "payment_attempts_refund_state_check",
        "payment_attempts_refund_record_check",
      ])
    );
  });

  test("records a refund's amount and time only on refunded paid Nexi attempts", async () => {
    const config = getTableConfig(paymentAttempts);
    const refundedAmount = config.columns.find(
      ({ name }) => name === "refunded_amount_value"
    );
    const refundedAt = config.columns.find(
      ({ name }) => name === "refunded_at"
    );
    const migration = await Bun.file(
      new URL(
        "../migrations/20261009150951_same_vector/migration.sql",
        import.meta.url
      )
    ).text();

    expect(refundedAmount?.notNull).toBe(false);
    expect(refundedAt?.notNull).toBe(false);
    expect(migration).toContain(
      "\"refund_state\" in ('not_required', 'required', 'refunded') and (\"refund_state\" = 'not_required' or (\"provider\" = 'nexi' and \"state\" = 'paid'))"
    );
    expect(migration).toContain(
      '("refund_state" = \'refunded\' and "refunded_amount_value" > 0 and "refunded_at" is not null) or ("refund_state" <> \'refunded\' and "refunded_amount_value" is null and "refunded_at" is null)'
    );
    expect(migration).toContain(
      'ADD COLUMN "refund_checked_at" timestamp with time zone;'
    );
    expect(
      config.columns.find(({ name }) => name === "refund_checked_at")?.notNull
    ).toBe(false);
  });

  test("migrates refund state with its paid Nexi invariant", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260813181657_numerous_bromley/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(
      "ADD COLUMN \"refund_state\" text DEFAULT 'not_required' NOT NULL"
    );
    expect(migration).toContain(
      "\"refund_state\" <> 'required' or (\"provider\" = 'nexi' and \"state\" = 'paid')"
    );
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

  test("records the durable Nexi order creation milestone", async () => {
    const config = getTableConfig(paymentAttempts);
    expect(
      config.columns.find(({ name }) => name === "provider_order_created_at")
        ?.notNull
    ).toBe(false);
    const migration = await Bun.file(
      new URL(
        "../migrations/20260806131357_marvelous_corsair/migration.sql",
        import.meta.url
      )
    ).text();
    expect(migration).toContain(
      'ADD COLUMN "provider_order_created_at" timestamp with time zone'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "payment_attempts_provider_fields_check"'
    );
    expect(migration).toContain('"provider_order_created_at" is null');
  });
});
