import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { testEmailAddress } from "@deskohub/test-email";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "../migration-scratch-database.test-utils";

const MIGRATION_DIR = "20261020104248_customer_account_contract";

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

/**
 * Brings a scratch database to the state production is in before the
 * contract migration, seeds it, and then applies the remaining migrations.
 */
const migrateAcross = async (
  seed: (pool: Pool) => Promise<void>,
  check: (pool: Pool, migrated: Promise<void>) => Promise<void>
) => {
  const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
  try {
    await withScratchDatabase(
      testDatabaseUrl!,
      "customer_account_contract",
      async (pool) => {
        await migrate(drizzle({ client: pool }), {
          migrationsFolder: earlierMigrations,
        });
        await seed(pool);
        const migrated = migrate(drizzle({ client: pool }), {
          migrationsFolder: workspaceMigrationsFolder,
        });
        // Observed by `check`; never left unhandled.
        migrated.catch(() => undefined);
        await check(pool, migrated);
      }
    );
  } finally {
    await rm(earlierMigrations, { recursive: true, force: true });
  }
};

const insertLogin = (pool: Pool, id: string, createdAt?: string) =>
  pool.query(
    `insert into auth."user" (id, name, email, created_at)
     values ($1, '', $2, coalesce($3::timestamptz, now()))`,
    [id, testEmailAddress(`contract-${id}`), createdAt ?? null]
  );

const insertAccount = (
  pool: Pool,
  id: string,
  fields: {
    readonly customer?: string;
    readonly deleted?: boolean;
    readonly createdAt?: string;
  } = {}
) =>
  pool.query(
    `insert into customer_accounts (id, dotypos_customer_id, deleted_at, created_at)
     values ($1, $2, case when $3 then now() end, coalesce($4::timestamptz, now()))`,
    [
      id,
      fields.customer ?? null,
      fields.deleted ?? false,
      fields.createdAt ?? null,
    ]
  );

const insertLink = (pool: Pool, accountId: string, customer: string) =>
  pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id)
     values ($1, $2)`,
    [accountId, customer]
  );

const insertReservation = (pool: Pool, authorAccountId: string | null) =>
  pool.query(
    `insert into workspace_reservations
       (checkout_attempt_key, dotypos_customer_id, author_account_id,
        reservation_state, payment_state, fulfillment_state,
        reservation_details, locale)
     values ($1, $2, $3, 'draft', 'not_started', 'not_started',
       '{"kind":"cowork","entryTier":"basic","coffee":false}', 'en-US')`,
    [`attempt:${crypto.randomUUID()}`, "contract-customer", authorAccountId]
  );

const accountRows = async (pool: Pool) => {
  const { rows } = await pool.query<{
    id: string;
    dotypos_customer_id: string | null;
    deleted: boolean;
    created_at: Date;
  }>(
    `select id, dotypos_customer_id, deleted_at is not null as deleted, created_at
       from customer_accounts`
  );
  return new Map(rows.map((row) => [row.id, row]));
};

/** The Postgres error a failed migration statement raised. */
const migrationFailure = async (migrated: Promise<void>) => {
  try {
    await migrated;
  } catch (error) {
    return (error as { readonly cause?: unknown }).cause;
  }
  throw new Error("The migration was expected to fail.");
};

const twoDaysAgo = () =>
  new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

describe.skipIf(!testDatabaseUrl)(
  "customer account contract migration on disposable Postgres",
  () => {
    test("gives every login an account, tombstones orphans and moves links onto accounts", async () => {
      const signedUpAt = "2026-09-01T08:00:00.000Z";
      await migrateAcross(
        async (pool) => {
          // A legacy login with only a link row and no account.
          await insertLogin(pool, "legacy", signedUpAt);
          await insertLink(pool, "legacy", "customer-legacy");
          // A login with an account the link isn't recorded on yet.
          await insertLogin(pool, "lazy");
          await insertAccount(pool, "lazy");
          await insertLink(pool, "lazy", "customer-lazy");
          // A link the previous deployment recorded on both.
          await insertLogin(pool, "dual");
          await insertAccount(pool, "dual", { customer: "customer-dual" });
          await insertLink(pool, "dual", "customer-dual");
          await insertReservation(pool, "dual");
          // A login that never linked a customer.
          await insertLogin(pool, "unlinked");
          // An account whose login is gone, and one whose login is still
          // being created.
          await insertAccount(pool, "orphan", { createdAt: twoDaysAgo() });
          await insertAccount(pool, "signing-up");
          // A tombstone a deployment before the column left naming its
          // customer.
          await insertAccount(pool, "tombstone", {
            customer: "customer-tombstone",
            deleted: true,
          });
        },
        async (pool, migrated) => {
          await migrated;
          const accounts = await accountRows(pool);

          expect(accounts.get("legacy")).toMatchObject({
            dotypos_customer_id: "customer-legacy",
            deleted: false,
          });
          expect(accounts.get("legacy")?.created_at.toISOString()).toBe(
            signedUpAt
          );
          expect(accounts.get("lazy")).toMatchObject({
            dotypos_customer_id: "customer-lazy",
            deleted: false,
          });
          expect(accounts.get("dual")).toMatchObject({
            dotypos_customer_id: "customer-dual",
            deleted: false,
          });
          expect(accounts.get("unlinked")).toMatchObject({
            dotypos_customer_id: null,
            deleted: false,
          });
          expect(accounts.get("orphan")).toMatchObject({ deleted: true });
          expect(accounts.get("signing-up")).toMatchObject({
            deleted: false,
          });
          expect(accounts.get("tombstone")).toMatchObject({
            dotypos_customer_id: null,
            deleted: true,
          });

          // A login can't exist without its account any more, and an
          // account a login names can't be deleted.
          await expect(insertLogin(pool, "accountless")).rejects.toMatchObject({
            code: "23503",
          });
          await expect(
            pool.query("delete from customer_accounts where id = 'unlinked'")
          ).rejects.toMatchObject({ code: "23001" });
          await expect(insertReservation(pool, null)).rejects.toMatchObject({
            code: "23502",
          });
        }
      );
    });

    test("refuses an account whose link names another customer", async () => {
      await migrateAcross(
        async (pool) => {
          await insertLogin(pool, "split");
          await insertAccount(pool, "split", { customer: "customer-one" });
          await insertLink(pool, "split", "customer-two");
        },
        async (pool, migrated) => {
          expect(await migrationFailure(migrated)).toMatchObject({
            code: "P0001",
            message: expect.stringContaining(
              "1 accounts hold another customer, 0 customers belong to another account"
            ),
          });
          expect(await accountRows(pool)).toEqual(
            new Map([
              [
                "split",
                expect.objectContaining({
                  dotypos_customer_id: "customer-one",
                }),
              ],
            ])
          );
        }
      );
    });

    test("refuses a linked customer another live account holds", async () => {
      await migrateAcross(
        async (pool) => {
          await insertLogin(pool, "linked");
          await insertLink(pool, "linked", "customer-shared");
          await insertLogin(pool, "holder");
          await insertAccount(pool, "holder", { customer: "customer-shared" });
        },
        async (_pool, migrated) => {
          expect(await migrationFailure(migrated)).toMatchObject({
            code: "P0001",
            message: expect.stringContaining(
              "0 accounts hold another customer, 1 customers belong to another account"
            ),
          });
        }
      );
    });

    test("refuses a reservation without an author", async () => {
      await migrateAcross(
        async (pool) => {
          await insertReservation(pool, null);
        },
        async (pool, migrated) => {
          expect(await migrationFailure(migrated)).toMatchObject({
            code: "23502",
          });
          const { rows } = await pool.query(
            `select 1 from information_schema.table_constraints
              where constraint_name = 'user_id_customer_accounts_id_fkey'`
          );
          expect(rows).toHaveLength(0);
        }
      );
    });
  }
);
