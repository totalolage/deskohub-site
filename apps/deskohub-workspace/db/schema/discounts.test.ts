import { describe, expect, test } from "bun:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Schema } from "effect";
import { getWorkspaceProductKey } from "@/features/checkout/product-identity";
import { canonicalPromotionCodeSchema } from "@/features/discounts/persistence-contracts";
import {
  workspaceCoworkProductIdentitySchema,
  workspaceCoworkProductKeySchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  discountApplications,
  discountCodeRedemptions,
  voucherRedemptions,
} from "./discount-applications";
import {
  discountCodes,
  discountProductTargets,
  discounts,
  promotionCodeCustomers,
  promotionCodes,
  vouchers,
} from "./discounts";

const configOf = (table: PgTable) => getTableConfig(table);

const namesOf = <T extends { readonly name?: string }>(values: readonly T[]) =>
  values.map(({ name }) => name);

describe("discount persistence contracts", () => {
  test("generated migration preserves the concurrency and privacy invariants", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260715202356_discount_codes/migration.sql",
        import.meta.url
      )
    ).text();

    for (const table of [
      "discounts",
      "discount_product_targets",
      "discount_codes",
      "discount_code_customers",
      "discount_applications",
      "discount_code_redemptions",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }

    expect(migration).toContain(
      `CREATE UNIQUE INDEX "discount_code_redemptions_active_customer_unique_idx" ON "discount_code_redemptions" USING btree ("code_id","dotypos_customer_id") WHERE "discount_code_redemptions"."state" in ('reserved', 'redeemed')`
    );
    expect(migration).not.toContain(
      "discount_code_redemptions_application_attempt_fk"
    );
    expect(migration).toContain(
      `CONSTRAINT "discount_codes_code_check" CHECK ("discount_codes"."code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$')`
    );
    expect(migration).not.toContain('"schema_version"');
    expect(migration).not.toContain('"customer_access_code"');
    expect(migration).not.toContain('"raw_payload"');
  });

  test("introduces vouchers separately without discarding discount codes", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260814094640_standalone_promotional_vouchers/migration.sql",
        import.meta.url
      )
    ).text();

    expect(20_260_814_094_640).toBeGreaterThan(20_260_813_192_416);
    expect(migration).toContain('CREATE TABLE "promotion_codes"');
    expect(migration).toContain('CREATE TABLE "vouchers"');
    expect(migration).toContain('CREATE TABLE "voucher_redemptions"');
    expect(migration).toContain('SELECT "id", \'discount\', "code", "enabled"');
    expect(migration.indexOf('INSERT INTO "promotion_codes"')).toBeLessThan(
      migration.indexOf(
        'ALTER TABLE "discount_codes" ADD COLUMN "promotion_code_id"'
      )
    );
    expect(migration).toContain(
      'UPDATE "discount_codes" SET "promotion_code_id" = "id"'
    );
    expect(migration).toContain(
      'CREATE FUNCTION "sync_discount_code_to_promotion"'
    );
    expect(migration).toContain(
      'CREATE FUNCTION "sync_promotion_to_discount_code"'
    );
    expect(migration).toContain(
      'CREATE FUNCTION "sync_legacy_discount_code_customer"'
    );
    expect(migration).toContain(
      'CREATE FUNCTION "sync_promotion_discount_code_customer"'
    );
    expect(migration.match(/IF pg_trigger_depth\(\) > 1 THEN/g)).toHaveLength(
      5
    );
    expect(migration).not.toContain(
      'ALTER TABLE "discount_codes" DROP COLUMN "code"'
    );
    expect(migration).not.toContain(
      'ALTER TABLE "discount_code_customers" RENAME TO'
    );
    expect(migration).not.toContain('ALTER COLUMN "discount_id" DROP NOT NULL');
  });

  test("adds explicit per-customer code limits without changing existing behavior", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260813192416_black_jane_foster/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('ADD COLUMN "max_uses_per_customer" integer');
    expect(migration).toContain(
      'UPDATE "discount_codes" SET "max_uses_per_customer" = 1 WHERE "max_uses" IS NOT NULL'
    );
    expect(
      migration.indexOf('ADD COLUMN "max_uses_per_customer"')
    ).toBeLessThan(migration.indexOf('UPDATE "discount_codes"'));
    expect(migration.indexOf('UPDATE "discount_codes"')).toBeLessThan(
      migration.indexOf(
        'DROP INDEX "discount_code_redemptions_active_customer_unique_idx"'
      )
    );
    expect(migration).toContain(
      'CONSTRAINT "discount_codes_max_uses_per_customer_check"'
    );
  });

  test("accepts only canonical product keys and discount codes", () => {
    const decodeProductKey = Schema.decodeUnknownSync(
      workspaceCoworkProductKeySchema
    );
    const decodeCode = Schema.decodeUnknownSync(canonicalPromotionCodeSchema);

    for (const tier of workspaceCoworkProductIdentitySchema.fields.tier
      .literals) {
      const productKey = getWorkspaceProductKey({ kind: "cowork", tier });
      expect(decodeProductKey(productKey)).toBe(productKey);
    }
    expect(decodeCode("LETNI_SLEVA-50")).toBe("LETNI_SLEVA-50");
    expect(() => decodeProductKey("cowork:enterprise")).toThrow();
    expect(() => decodeCode("lowercase")).toThrow();
    expect(() => decodeCode("AB")).toThrow();
  });

  test("stores exactly one valid benefit adjustment", () => {
    const config = configOf(discounts);
    const labelsColumn = config.columns.find(({ name }) => name === "labels");

    expect(config.name).toBe("discounts");
    expect(labelsColumn?.notNull).toBe(true);
    expect(namesOf(config.checks)).toEqual([
      "discounts_adjustment_variant_check",
      "discounts_percentage_basis_points_check",
      "discounts_fixed_amount_check",
    ]);
    expect(config.columns.map(({ name }) => name)).not.toContain("label");
    expect(config.columns.map(({ name }) => name)).not.toContain("source");
    expect(config.columns.map(({ name }) => name)).not.toContain("provider");
    expect(config.columns.map(({ name }) => name)).not.toContain(
      "schema_version"
    );
  });

  test("uses family targets for discounts and composite customer allowlists", () => {
    const targetConfig = configOf(discountProductTargets);

    expect(targetConfig.name).toBe("discount_targets");
    expect(namesOf(targetConfig.primaryKeys)).toEqual(["discount_targets_pk"]);
    expect(targetConfig.columns.map(({ name }) => name)).toEqual([
      "discount_id",
      "product_target",
    ]);
    expect(namesOf(configOf(promotionCodeCustomers).primaryKeys)).toEqual([
      "promotion_code_customers_pk",
    ]);
  });

  test("migrates product targets to identity-only storage", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260717172119_cloudy_nextwave/migration.sql",
        import.meta.url
      )
    ).text();
    const dropPrimaryKey = 'DROP CONSTRAINT "discount_product_targets_pk"';
    const dropProductKey = 'DROP COLUMN "product_key"';

    expect(migration).toContain(dropPrimaryKey);
    expect(migration).toContain(dropProductKey);
    expect(migration.indexOf(dropPrimaryKey)).toBeLessThan(
      migration.indexOf(dropProductKey)
    );
    expect(migration).toContain(
      'PRIMARY KEY("discount_id","product_identity")'
    );
  });

  test("migrates meeting-room discount identities to semantic durations", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260801094540_semantic_meeting_room_durations/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain(
      "'duration', CASE \"product_identity\" ->> 'durationMinutes'"
    );
    expect(migration).toContain(
      "WHEN '1440' THEN jsonb_build_object('unit', 'day', 'amount', 1)"
    );
    expect(migration).toContain('UPDATE "workspace_reservations"');
    expect(migration).toContain(
      `SET "reservation_details" = jsonb_build_object('kind', 'meeting-room')`
    );
    expect(migration).toContain('DELETE FROM "discount_product_targets"');
    expect(migration).toContain('UPDATE "discount_applications"');
    expect(migration).toContain(
      "Cannot migrate an unknown legacy meeting-room duration"
    );
  });

  test("migrates identities to canonical family targets with rollout compatibility", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260810143301_late_morbius/migration.sql",
        import.meta.url
      )
    ).text();

    expect(migration).toContain('CREATE TABLE "discount_targets"');
    expect(migration).toContain(
      'CONSTRAINT "discount_targets_pk" PRIMARY KEY("discount_id","product_target")'
    );
    expect(migration).toContain(
      "SELECT DISTINCT\n\t\"discount_id\",\n\tjsonb_build_object('kind', \"product_identity\" ->> 'kind')"
    );
    expect(migration).toContain(
      'CREATE TRIGGER "sync_legacy_discount_product_targets"'
    );
    expect(migration).toContain(
      'CREATE TRIGGER "sync_discount_targets_to_legacy"'
    );
    expect(migration).toContain("'tier', 'profi'");
    expect(migration).toContain(
      "'duration', jsonb_build_object('unit', 'day', 'amount', 1)"
    );
    expect(migration).not.toContain('DROP TABLE "discount_product_targets"');
    expect(migration).not.toContain('DROP COLUMN "product_identity"');
    expect(migration).toContain(
      "Cannot migrate an unknown discount product identity"
    );
  });

  test("removes the superseded scalar discount label", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/20260717172119_cloudy_nextwave/migration.sql",
        import.meta.url
      )
    ).text();
    const dropLabelCheck = 'DROP CONSTRAINT "discounts_label_check"';
    const dropLabel = 'DROP COLUMN "label"';

    expect(migration).toContain(dropLabelCheck);
    expect(migration).toContain(dropLabel);
    expect(migration.indexOf(dropLabelCheck)).toBeLessThan(
      migration.indexOf(dropLabel)
    );
  });

  test("enforces separate aggregates with rollout-compatible code mirrors", () => {
    const promotionConfig = configOf(promotionCodes);
    const codeConfig = configOf(discountCodes);
    const voucherConfig = configOf(vouchers);
    const discountId = codeConfig.columns.find(
      ({ name }) => name === "discount_id"
    );

    expect(discountId?.notNull).toBe(true);
    expect(namesOf(promotionConfig.checks)).toEqual([
      "promotion_codes_code_check",
      "promotion_codes_valid_window_check",
      "promotion_codes_kind_check",
    ]);
    expect(namesOf(codeConfig.checks)).toEqual([
      "discount_codes_promotion_kind_check",
      "discount_codes_code_check",
      "discount_codes_valid_window_check",
      "discount_codes_max_uses_check",
      "discount_codes_max_uses_per_customer_check",
    ]);
    expect(namesOf(voucherConfig.checks)).toEqual([
      "vouchers_promotion_kind_check",
      "vouchers_issued_amount_check",
    ]);
    expect(
      promotionConfig.indexes.map(({ config: index }) => [
        index.name,
        index.unique,
      ])
    ).toContainEqual(["promotion_codes_code_unique_idx", true]);
    expect(codeConfig.columns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["code", "enabled", "valid_from", "valid_until"])
    );
    expect(voucherConfig.columns.map(({ name }) => name)).not.toContain(
      "discount_id"
    );
  });

  test("keeps immutable application snapshots source-neutral", () => {
    const config = configOf(discountApplications);
    const columns = config.columns.map(({ name }) => name);

    expect(columns).toContain("public_discount_id");
    expect(columns).toContain("label");
    expect(columns).toContain("adjustment");
    expect(columns).toContain("product_identity");
    expect(columns).toContain("provenance");
    expect(columns).not.toContain("labels");
    expect(columns).not.toContain("updated_at");
    expect(namesOf(config.checks)).toEqual([
      "discount_applications_sequence_check",
      "discount_applications_identity_check",
      "discount_applications_money_values_check",
      "discount_applications_money_exponents_check",
      "discount_applications_money_currencies_check",
      "discount_applications_countdown_check",
    ]);
    expect(
      config.foreignKeys.map((foreignKey) => foreignKey.getName())
    ).not.toContain("discount_applications_public_discount_id_discounts_id_fk");
  });

  test("keeps ordinary and voucher claim invariants independent", () => {
    const codeConfig = configOf(discountCodeRedemptions);
    const voucherConfig = configOf(voucherRedemptions);
    const indexes = codeConfig.indexes.map(({ config: index }) => ({
      name: index.name,
      unique: index.unique,
      partial: index.where !== undefined,
    }));

    expect(indexes).not.toContainEqual({
      name: "discount_code_redemptions_active_customer_unique_idx",
      unique: true,
      partial: true,
    });
    expect(indexes).toContainEqual({
      name: "discount_code_redemptions_stale_reserved_idx",
      unique: false,
      partial: true,
    });
    expect(
      codeConfig.foreignKeys.map((foreignKey) => foreignKey.getName())
    ).toEqual(
      expect.arrayContaining([
        "discount_code_redemptions_application_id_discount_applications_id_fk",
        "discount_code_redemptions_code_id_discount_codes_id_fk",
        "discount_code_redemptions_payment_attempt_id_payment_attempts_id_fk",
      ])
    );
    expect(namesOf(codeConfig.checks)).not.toContain(
      "discount_code_redemptions_kind_check"
    );
    expect(namesOf(codeConfig.checks)).toContain(
      "discount_code_redemptions_lifecycle_check"
    );
    expect(
      voucherConfig.indexes.map(({ config: index }) => ({
        name: index.name,
        unique: index.unique,
        partial: index.where !== undefined,
      }))
    ).toContainEqual({
      name: "voucher_redemptions_active_customer_unique_idx",
      unique: true,
      partial: true,
    });
  });
});
