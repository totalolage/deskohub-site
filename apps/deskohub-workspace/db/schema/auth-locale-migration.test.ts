import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261013062101_customer_locale_preference";

/**
 * An earlier, unreleased revision of this migration that preview databases
 * may already have recorded under its own folder name.
 */
const EARLIER_REVISION_DIR = "20261012213118_customer_locale_preferences";
const earlierRevisionSql = `CREATE TABLE "customer_locale_preferences" (
	"customer_account_id" text PRIMARY KEY,
	"locale" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_locale_preferences_locale_check" CHECK ("locale" in ('en-US', 'cs-CZ'))
);
--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "active_customer_email_delivery_locale" text;--> statement-breakpoint
ALTER TABLE "customer_locale_preferences" ADD CONSTRAINT "customer_locale_preferences_customer_account_id_user_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "auth"."user"("id") ON DELETE CASCADE;`;

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const insertLegacyAccounts = async (
  pool: Pool,
  ensureCustomerAccounts = false
) => {
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of ids) {
    if (ensureCustomerAccounts) {
      await pool.query(
        `insert into customer_accounts (id) values ($1) on conflict do nothing`,
        [id]
      );
    }
    await pool.query(
      `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, true)`,
      [id, testEmailAddress(`legacy-${id}`)]
    );
  }
  return ids;
};

const localesOf = async (pool: Pool, ids: readonly string[]) =>
  (
    await pool.query<{ locale: string | null }>(
      `select locale from auth."user" where id = any($1)`,
      [ids]
    )
  ).rows.map((row) => row.locale);

const tableExists = async (pool: Pool, table: string) =>
  (
    await pool.query<{ present: boolean }>(
      `select to_regclass($1) is not null as present`,
      [table]
    )
  ).rows[0]!.present;

describe.skipIf(!testDatabaseUrl)(
  "customer locale preference migration",
  () => {
    test(
      "leaves accounts that existed before the migration without a locale preference",
      async () => {
        const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
        try {
          await withScratchDatabase(
            testDatabaseUrl!,
            "locale_migration",
            async (pool) => {
              await migrate(drizzle({ client: pool }), {
                migrationsFolder: earlierMigrations,
              });
              const legacyAccountIds = await insertLegacyAccounts(pool);

              await migrate(drizzle({ client: pool }), {
                migrationsFolder: workspaceMigrationsFolder,
              });

              expect(await localesOf(pool, legacyAccountIds)).toEqual([
                null,
                null,
              ]);
              expect(
                await tableExists(pool, "customer_locale_preferences")
              ).toBe(false);
            }
          );
        } finally {
          await rm(earlierMigrations, { recursive: true, force: true });
        }
      },
      { timeout: 60000 }
    );

    test(
      "accepts only en-US and cs-CZ as a locale preference",
      async () => {
        await withScratchDatabase(
          testDatabaseUrl!,
          "locale_migration",
          async (pool) => {
            await migrate(drizzle({ client: pool }), {
              migrationsFolder: workspaceMigrationsFolder,
            });
            const [account] = await insertLegacyAccounts(pool, true);

            await pool.query(
              `update auth."user" set locale = 'cs-CZ' where id = $1`,
              [account]
            );
            await expect(
              pool.query(
                `update auth."user" set locale = 'de-DE' where id = $1`,
                [account]
              )
            ).rejects.toMatchObject({ code: "23514" });
            expect(await localesOf(pool, [account!])).toEqual(["cs-CZ"]);
          }
        );
      },
      { timeout: 60000 }
    );

    test(
      "upgrades a database that recorded an earlier revision of the migration",
      async () => {
        const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
        const upgradedMigrations = await linkMigrationsBefore(MIGRATION_DIR);
        try {
          for (const folder of [earlierMigrations, upgradedMigrations]) {
            await mkdir(join(folder, EARLIER_REVISION_DIR));
            await writeFile(
              join(folder, EARLIER_REVISION_DIR, "migration.sql"),
              earlierRevisionSql
            );
          }
          await symlink(
            join(workspaceMigrationsFolder, MIGRATION_DIR),
            join(upgradedMigrations, MIGRATION_DIR)
          );

          await withScratchDatabase(
            testDatabaseUrl!,
            "locale_migration",
            async (pool) => {
              await migrate(drizzle({ client: pool }), {
                migrationsFolder: earlierMigrations,
              });
              const legacyAccountIds = await insertLegacyAccounts(pool);
              expect(
                await tableExists(pool, "customer_locale_preferences")
              ).toBe(true);

              await migrate(drizzle({ client: pool }), {
                migrationsFolder: upgradedMigrations,
              });

              expect(await localesOf(pool, legacyAccountIds)).toEqual([
                null,
                null,
              ]);
              expect(
                await tableExists(pool, "customer_locale_preferences")
              ).toBe(false);
              const slot = await pool.query(
                `select 1 from information_schema.columns where table_name = 'workspace_reservations' and column_name = 'active_customer_email_delivery_locale'`
              );
              expect(slot.rows).toHaveLength(1);
            }
          );
        } finally {
          await rm(earlierMigrations, { recursive: true, force: true });
          await rm(upgradedMigrations, { recursive: true, force: true });
        }
      },
      { timeout: 60000 }
    );
  }
);
