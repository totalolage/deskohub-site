import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  paymentAttempts,
  paymentProviders,
  paymentRefundStates,
} from "./payment-attempts";
import { webhookProviders } from "./webhook-events";

describe("payment attempt order ledger", () => {
  const attemptColumn = (name: string) =>
    getTableConfig(paymentAttempts).columns.find(
      ({ name: columnName }) => columnName === name
    );

  test("keeps every attempt owned by its workspace reservation", () => {
    const workspaceReservationId = attemptColumn("workspace_reservation_id");

    expect(workspaceReservationId?.notNull).toBe(true);
  });

  test("links attempts to their order with matching reservation identity", () => {
    const config = getTableConfig(paymentAttempts);
    const orderId = config.columns.find(({ name }) => name === "order_id");
    const checks = config.checks.map(({ name }) => name);
    const matchCheck = config.checks.find(
      ({ name }) => name === "payment_attempts_reservation_order_match_check"
    );

    expect(orderId?.notNull).toBe(false);
    expect(checks).toContain("payment_attempts_reservation_order_match_check");
    expect(
      config.indexes.some(
        ({ config: index }) => index.name === "payment_attempts_order_idx"
      )
    ).toBe(true);
    const matchCheckSql = new PgDialect().sqlToQuery(matchCheck!.value).sql;
    expect(matchCheckSql).toContain('"order_id" is null');
    expect(matchCheckSql).toContain(
      '"order_id" = "payment_attempts"."workspace_reservation_id"'
    );
  });

  test("preserves reservation ownership and cascades in the generated snapshot", async () => {
    const migrationDirUrl = new URL("../migrations/", import.meta.url);
    const migrationDir = migrationDirUrl.pathname;
    const migrationFolders = (
      await Array.fromAsync(
        new Bun.Glob("*/snapshot.json").scan({ cwd: migrationDir })
      )
    )
      .sort()
      .map((path) => path.replace("/snapshot.json", ""));
    const latest = migrationFolders.at(-1);
    expect(latest).toBeDefined();
    const snapshot = (await Bun.file(
      new URL(`${latest}/snapshot.json`, migrationDirUrl)
    ).json()) as {
      ddl: Array<{
        table?: string;
        tableTo?: string;
        onDelete?: string;
        columns?: string[];
        entityType?: string;
      }>;
    };
    const foreignKeys = snapshot.ddl.filter(
      ({ table, entityType }) =>
        table === "payment_attempts" && entityType === "fks"
    );

    expect(foreignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tableTo: "orders",
          columns: ["order_id"],
          onDelete: "CASCADE",
        }),
        expect.objectContaining({
          tableTo: "workspace_reservations",
          columns: ["workspace_reservation_id"],
          onDelete: "CASCADE",
        }),
      ])
    );
  });

  test("expands the payment ledger with a lossless reservation backfill", async () => {
    const migrationDirUrl = new URL("../migrations/", import.meta.url);
    const migrationDir = migrationDirUrl.pathname;
    const migrationFolders = (
      await Array.fromAsync(
        new Bun.Glob("*/migration.sql").scan({ cwd: migrationDir })
      )
    )
      .sort()
      .map((path) => path.replace("/migration.sql", ""));
    const latest = migrationFolders.at(-1);
    expect(latest).toBeDefined();
    const migration = await Bun.file(
      new URL(`${latest}/migration.sql`, migrationDirUrl)
    ).text();

    expect(migration).toContain('ADD COLUMN "order_id" text');
    expect(migration).not.toContain("DROP NOT NULL");
    expect(migration).toContain('FROM "workspace_reservations"');
    expect(migration).toContain('UPDATE "payment_attempts"');
    expect(migration).toContain('"order_id" = "workspace_reservation_id"');
    expect(migration).toContain(
      'ADD CONSTRAINT "payment_attempts_reservation_order_match_check"'
    );
  });
});

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
