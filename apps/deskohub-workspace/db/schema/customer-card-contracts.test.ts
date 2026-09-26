import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import {
  customerCardContracts,
  customerCardEnrollments,
} from "./customer-card-contracts";

const readMigration = () =>
  Bun.file(
    new URL(
      "../migrations/20260926101240_panoramic_stryfe/migration.sql",
      import.meta.url
    )
  ).text();

describe("customer card contracts", () => {
  test("stores only opaque references and display metadata", () => {
    const config = getTableConfig(customerCardContracts);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );

    expect(columns.customer_account_id?.notNull).toBe(true);
    expect(columns.provider_customer_id?.notNull).toBe(true);
    expect(columns.provider_contract_id?.notNull).toBe(true);
    expect(columns.state?.notNull).toBe(true);
    expect(columns.state?.hasDefault).toBe(true);
    expect(columns.display_circuit?.notNull).toBe(false);
    expect(columns.display_suffix?.notNull).toBe(false);
    expect(config.name).toBe("customer_card_contracts");
    expect(
      config.indexes
        .filter((index) => index.config.unique)
        .flatMap((index) => index.config.columns.map((column) => column.name))
    ).toEqual(["provider_contract_id"]);
  });

  test("restricts contract state and display metadata", () => {
    const config = getTableConfig(customerCardContracts);

    const stateCheck = config.checks.find(
      ({ name }) => name === "customer_card_contracts_state_check"
    );
    expect(new PgDialect().sqlToQuery(stateCheck!.value).sql).toBe(
      `"customer_card_contracts"."state" in ('active', 'removed')`
    );

    const circuitCheck = config.checks.find(
      ({ name }) => name === "customer_card_contracts_display_circuit_check"
    );
    expect(new PgDialect().sqlToQuery(circuitCheck!.value).sql).toBe(
      `"customer_card_contracts"."display_circuit" is null or "customer_card_contracts"."display_circuit" ~ '^[A-Z0-9_]{1,20}$'`
    );

    const suffixCheck = config.checks.find(
      ({ name }) => name === "customer_card_contracts_display_suffix_check"
    );
    expect(new PgDialect().sqlToQuery(suffixCheck!.value).sql).toBe(
      `"customer_card_contracts"."display_suffix" is null or "customer_card_contracts"."display_suffix" ~ '^[0-9]{1,4}$'`
    );
  });

  test("cascades from the Better Auth user", () => {
    const config = getTableConfig(customerCardContracts);
    const foreignKey = config.foreignKeys[0];
    const reference = foreignKey!.reference();
    const referenced = getTableConfig(reference.foreignTable);

    expect(reference.columns.map(({ name }) => name)).toEqual([
      "customer_account_id",
    ]);
    expect(referenced.schema).toBe("auth");
    expect(referenced.name).toBe("user");
    expect(foreignKey!.onDelete).toBe("cascade");
  });
});

describe("customer card enrollments", () => {
  test("stores only opaque references and the security-token digest", () => {
    const config = getTableConfig(customerCardEnrollments);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );

    expect(config.columns.map(({ name }) => name)).toEqual([
      "id",
      "customer_account_id",
      "order_id",
      "provider_customer_id",
      "provider_contract_id",
      "security_token_digest",
      "state",
      "failure_code",
      "created_at",
      "updated_at",
    ]);
    expect(columns.state?.hasDefault).toBe(true);
    expect(
      config.indexes
        .filter((index) => index.config.unique)
        .flatMap((index) => index.config.columns.map((column) => column.name))
    ).toEqual(["order_id"]);
  });

  test("restricts state, digest, and failure code", () => {
    const config = getTableConfig(customerCardEnrollments);

    const digestCheck = config.checks.find(
      ({ name }) => name === "customer_card_enrollments_security_token_digest_check"
    );
    expect(new PgDialect().sqlToQuery(digestCheck!.value).sql).toBe(
      `"customer_card_enrollments"."security_token_digest" ~ '^[0-9a-f]{64}$'`
    );

    const stateCheck = config.checks.find(
      ({ name }) => name === "customer_card_enrollments_state_check"
    );
    expect(new PgDialect().sqlToQuery(stateCheck!.value).sql).toBe(
      `"customer_card_enrollments"."state" in ('pending', 'confirmed', 'failed', 'cancelled')`
    );

    const failureCheck = config.checks.find(
      ({ name }) => name === "customer_card_enrollments_failure_code_check"
    );
    expect(new PgDialect().sqlToQuery(failureCheck!.value).sql).toBe(
      `"customer_card_enrollments"."state" not in ('failed', 'cancelled') or btrim("customer_card_enrollments"."failure_code") <> ''`
    );
  });

  test("creates only the two new tables in the migration", async () => {
    const migration = await readMigration();

    expect(migration.match(/CREATE TABLE/g)?.length).toBe(2);
    expect(migration).toContain('CREATE TABLE "customer_card_contracts" (');
    expect(migration).toContain('CREATE TABLE "customer_card_enrollments" (');
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("ALTER TABLE \"auth\"");
  });
});
