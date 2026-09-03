import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { authUser } from "./auth";
import { customerAccountLinks } from "./customer-account-links";

const readMigration = () =>
  Bun.file(
    new URL(
      "../migrations/20260903094459_regular_wolverine/migration.sql",
      import.meta.url
    )
  ).text();

describe("customer account links", () => {
  test("stores only the opaque account ID and Dotypos customer ID", () => {
    const config = getTableConfig(customerAccountLinks);
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );

    expect(config.columns.map(({ name }) => name)).toEqual([
      "customer_account_id",
      "dotypos_customer_id",
    ]);
    expect(columns.customer_account_id?.primary).toBe(true);
    expect(columns.customer_account_id?.notNull).toBe(true);
    expect(columns.dotypos_customer_id?.notNull).toBe(true);
    expect(config.name).toBe("customer_account_links");
    expect(config.schema).toBeUndefined();
  });

  test("cascades from the Better Auth user", () => {
    const config = getTableConfig(customerAccountLinks);
    const foreignKey = config.foreignKeys[0];
    const reference = foreignKey!.reference();
    const referenced = getTableConfig(reference.foreignTable);

    expect(reference.columns.map(({ name }) => name)).toEqual([
      "customer_account_id",
    ]);
    expect(referenced.schema).toBe("auth");
    expect(referenced.name).toBe("user");
    expect(reference.foreignColumns.map(({ name }) => name)).toEqual(["id"]);
    expect(foreignKey!.onDelete).toBe("cascade");
    expect(
      getTableConfig(authUser).columns.find(({ name }) => name === "id")!
        .primary
    ).toBe(true);
  });

  test("allows one nonblank Dotypos customer per account", () => {
    const config = getTableConfig(customerAccountLinks);

    expect(
      config.indexes
        .filter((index) => index.config.unique)
        .flatMap((index) => index.config.columns.map((column) => column.name))
    ).toEqual(["dotypos_customer_id"]);

    const check = config.checks.find(
      ({ name }) => name === "customer_account_links_customer_check"
    );
    expect(check).toBeDefined();
    expect(new PgDialect().sqlToQuery(check!.value).sql).toBe(
      'btrim("customer_account_links"."dotypos_customer_id") <> \'\''
    );
  });

  test("creates the schema and tables additively in one migration", async () => {
    const migration = await readMigration();

    expect(migration).toContain('CREATE SCHEMA "auth";');
    expect(migration.match(/CREATE TABLE/g)?.length).toBe(6);
    expect(migration).toContain(
      'ADD CONSTRAINT "customer_account_links_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE'
    );
    expect(migration).not.toContain("DROP ");
    expect(migration).not.toContain("workspace_reservations");
    expect(migration).not.toContain("invoices");
    expect(migration).not.toContain("discount");
    expect(migration).not.toContain("cli_");
  });
});
