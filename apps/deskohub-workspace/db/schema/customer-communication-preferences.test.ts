import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { authUser } from "./auth";
import { customerCommunicationPreferences } from "./customer-communication-preferences";

const MIGRATION_DIR = "20260926095534_sturdy_pete_wisdom";

const readBackfillStatement = async () => {
  const migration = await Bun.file(
    new URL(`../migrations/${MIGRATION_DIR}/migration.sql`, import.meta.url)
  ).text();
  const backfill = migration
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .find((statement) =>
      statement.includes(`INSERT INTO "customer_communication_preferences"`)
    );
  expect(backfill).toBeTruthy();
  return backfill!;
};

const insertAuthUser = async (
  pool: NonNullable<
    Awaited<ReturnType<typeof connectWorkspacePostgresTestDatabase>>
  >,
  id: string,
  email: string
) => {
  await pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const uniqueId = () => crypto.randomUUID();

describe("customer communication preferences", () => {
  test("shapes the required preference table", () => {
    const config = getTableConfig(customerCommunicationPreferences);
    expect(config.name).toBe("customer_communication_preferences");
    const columns = Object.fromEntries(
      config.columns.map((column) => [column.name, column])
    );
    expect(columns.customer_account_id?.primary).toBe(true);
    expect(columns.locale?.notNull).toBe(true);
    expect(config.checks.length).toBe(1);
    expect(new PgDialect().sqlToQuery(config.checks[0]!.value).sql).toContain(
      "'en-US'"
    );
  });

  test(
    "backfills every existing account and stays idempotent on a repeated run",
    async () => {
      const testDatabase = await connectWorkspacePostgresTestDatabase();
      if (!testDatabase) return;

      const backfill = await readBackfillStatement();
      const missingAccountId = uniqueId();
      const savedAccountId = uniqueId();
      await insertAuthUser(
        testDatabase.pool,
        missingAccountId,
        `backfill-missing-${missingAccountId}@deskohub.test`
      );
      await insertAuthUser(
        testDatabase.pool,
        savedAccountId,
        `backfill-saved-${savedAccountId}@deskohub.test`
      );
      await testDatabase.pool.query(
        `insert into customer_communication_preferences (customer_account_id, locale) values ($1, 'cs-CZ')`,
        [savedAccountId]
      );

      // First run: the account without a preference gets the site default;
      // the saved cs-CZ preference is preserved untouched.
      await testDatabase.pool.query(backfill);

      const afterFirstRun = await testDatabase.pool.query(
        `select customer_account_id, locale from customer_communication_preferences where customer_account_id = any($1) order by locale`,
        [[missingAccountId, savedAccountId]]
      );
      expect(afterFirstRun.rows).toEqual([
        { customer_account_id: savedAccountId, locale: "cs-CZ" },
        { customer_account_id: missingAccountId, locale: "en-US" },
      ]);

      // Repeated run (the reconciliation scenario): idempotent, no overwrite,
      // no duplicate rows.
      await testDatabase.pool.query(backfill);

      const afterSecondRun = await testDatabase.pool.query(
        `select customer_account_id, locale from customer_communication_preferences where customer_account_id = any($1) order by locale`,
        [[missingAccountId, savedAccountId]]
      );
      expect(afterSecondRun.rows).toEqual(afterFirstRun.rows);
    },
    { timeout: 30000 }
  );
});
