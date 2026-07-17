import { describe, expect, test } from "bun:test";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { Schema } from "effect";
import { discountProductIdentityCodec } from "@/features/discounts/contracts";
import {
  canonicalDiscountCodeSchema,
  discountProductKeySchema,
} from "@/features/discounts/persistence-contracts";
import {
  discountApplications,
  discountCodeRedemptions,
} from "./discount-applications";
import {
  discountCodeCustomers,
  discountCodes,
  discountProductTargets,
  discounts,
} from "./discounts";

const configOf = (table: PgTable) => getTableConfig(table);

const namesOf = <T extends { readonly name?: string }>(values: readonly T[]) =>
  values.map(({ name }) => name);

describe("discount persistence contracts", () => {
  test("generated migration preserves the concurrency and privacy invariants", async () => {
    const migration = await Bun.file(
      new URL("../migrations/0002_discount_codes.sql", import.meta.url)
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

  test("localized-label migration expands, backfills, verifies, and constrains", async () => {
    const migration = await Bun.file(
      new URL(
        "../migrations/0003_localized_discount_labels.sql",
        import.meta.url
      )
    ).text();

    const addColumn = migration.indexOf(
      'ALTER TABLE "discounts" ADD COLUMN "labels" jsonb;'
    );
    const backfill = migration.indexOf(
      "WHERE \"id\" = '019f6f31-d00f-7a94-86fa-764f425e7fab'"
    );
    const verification = migration.indexOf("RAISE EXCEPTION");
    const setNotNull = migration.indexOf(
      'ALTER TABLE "discounts" ALTER COLUMN "labels" SET NOT NULL;'
    );

    expect(addColumn).toBeGreaterThanOrEqual(0);
    expect(backfill).toBeGreaterThan(addColumn);
    expect(verification).toBeGreaterThan(backfill);
    expect(setNotNull).toBeGreaterThan(verification);
    expect(migration).toContain("'en-US', '50% summer discount'");
    expect(migration).toContain("'cs-CZ', 'Letní sleva 50 %'");
    expect(migration).toContain("\"labels\" - ARRAY['en-US', 'cs-CZ']::text[]");
    expect(migration).not.toContain('ADD COLUMN "labels" jsonb NOT NULL');
    expect(migration).not.toContain('DROP COLUMN "label"');
    expect(migration).not.toContain('ALTER TABLE "discount_applications"');
    expect(migration).not.toContain("PRODUCT_OWNER_APPROVED");
  });

  test("accepts only canonical product keys and discount codes", () => {
    const decodeProductKey = Schema.decodeUnknownSync(discountProductKeySchema);
    const decodeCode = Schema.decodeUnknownSync(canonicalDiscountCodeSchema);

    for (const tier of discountProductIdentityCodec.fields.tier.literals) {
      expect(decodeProductKey(`cowork:${tier}`)).toBe(`cowork:${tier}`);
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
      "discounts_label_check",
      "discounts_adjustment_variant_check",
      "discounts_percentage_basis_points_check",
      "discounts_fixed_amount_check",
    ]);
    expect(config.columns.map(({ name }) => name)).not.toContain("source");
    expect(config.columns.map(({ name }) => name)).not.toContain("provider");
    expect(config.columns.map(({ name }) => name)).not.toContain(
      "schema_version"
    );
  });

  test("uses composite identities for targets and allowlists", () => {
    expect(namesOf(configOf(discountProductTargets).primaryKeys)).toEqual([
      "discount_product_targets_pk",
    ]);
    expect(namesOf(configOf(discountCodeCustomers).primaryKeys)).toEqual([
      "discount_code_customers_pk",
    ]);
  });

  test("enforces canonical code configuration in the database schema", () => {
    const config = configOf(discountCodes);

    expect(namesOf(config.checks)).toEqual([
      "discount_codes_code_check",
      "discount_codes_valid_window_check",
      "discount_codes_max_uses_check",
    ]);
    expect(
      config.indexes.map(({ config: index }) => [index.name, index.unique])
    ).toContainEqual(["discount_codes_code_unique_idx", true]);
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

  test("prevents duplicate active customer claims while retaining releases", () => {
    const config = configOf(discountCodeRedemptions);
    const indexes = config.indexes.map(({ config: index }) => ({
      name: index.name,
      unique: index.unique,
      partial: index.where !== undefined,
    }));

    expect(indexes).toContainEqual({
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
      config.foreignKeys.map((foreignKey) => foreignKey.getName())
    ).toEqual(
      expect.arrayContaining([
        "discount_code_redemptions_application_id_discount_applications_id_fk",
        "discount_code_redemptions_payment_attempt_id_payment_attempts_id_fk",
      ])
    );
    expect(namesOf(config.checks)).toContain(
      "discount_code_redemptions_lifecycle_check"
    );
  });
});
