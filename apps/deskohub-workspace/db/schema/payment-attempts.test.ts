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

  test("links attempts to orders while retaining the nullable reservation compatibility link", async () => {
    const config = getTableConfig(paymentAttempts);
    const orderId = config.columns.find(({ name }) => name === "order_id");
    const reservationId = config.columns.find(
      ({ name }) => name === "workspace_reservation_id"
    );
    const migration = await Bun.file(
      new URL(
        "../migrations/20260821205013_order_payment_ledger_expand/migration.sql",
        import.meta.url
      )
    ).text();

    expect(orderId?.notNull).toBe(false);
    expect(reservationId?.notNull).toBe(false);
    expect(config.checks.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "payment_attempts_order_reference_check",
        "payment_attempts_reservation_order_match_check",
      ])
    );
    expect(migration).toContain('ON CONFLICT ("id") DO UPDATE SET');
    expect(migration).toContain(
      "RAISE EXCEPTION 'reservation id collides with a non-reservation order'"
    );
    expect(migration).not.toContain(
      'LOCK TABLE "workspace_reservations" IN SHARE MODE'
    );
    expect(migration).not.toContain(
      "reservation order repair did not converge"
    );
    expect(migration).toContain('SET "order_id" = "workspace_reservation_id"');
    expect(migration).toContain(
      'ADD CONSTRAINT "orders_active_payment_attempt_id_payment_attempts_id_fkey"'
    );
  });

  test("tracks required refunds separately from successful payment", () => {
    const config = getTableConfig(paymentAttempts);
    const refundState = config.columns.find(
      ({ name }) => name === "refund_state"
    );

    expect(paymentRefundStates).toEqual(["not_required", "required"]);
    expect(refundState).toMatchObject({ hasDefault: true, notNull: true });
    expect(config.checks.map(({ name }) => name)).toContain(
      "payment_attempts_refund_state_check"
    );
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
