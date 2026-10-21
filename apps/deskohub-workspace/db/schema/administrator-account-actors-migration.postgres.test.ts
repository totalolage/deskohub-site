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

const MIGRATION_DIR = "20261016154821_administrator_account_actors";
const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const insertAuthenticationRequest = async (
  pool: Pool,
  codeHash: string,
  approval?: { readonly approvedBy: string | null }
) =>
  (
    await pool.query<{ id: string }>(
      `insert into cli_authentication_requests (
         code_hash, challenge, client_name, cli_version, build_target,
         expires_at, approved_at, approved_by, grant_expires_at
       ) values (
         repeat($1, 43), repeat($2, 43), 'Synthetic CLI', '1.0.0', 'development',
         now() + interval '5 minutes',
         case when $3::boolean then now() else null end,
         $4,
         case when $3::boolean then now() + interval '1 hour' else null end
       ) returning id`,
      [
        codeHash,
        codeHash.toUpperCase(),
        approval !== undefined,
        approval?.approvedBy ?? null,
      ]
    )
  ).rows[0]!.id;

const insertAccessCodeEvent = async (pool: Pool, actor: string | null) =>
  (
    await pool.query<{ id: string }>(
      `insert into standalone_access_code_attempt_events (
         attempt_id, event_kind, actor, actor_account_id, actor_account_email,
         source, name, device_id, starts_at_local, ends_at_local,
         starts_at, ends_at, variance, occurred_at
       ) values (
         $1, 'started', $2, null, null,
         'admin-ui', 'Synthetic access code', 'synthetic-device',
         '2026-10-16T10:00', '2026-10-16T11:00',
         now(), now() + interval '1 hour', 2, now()
       ) returning id`,
      [crypto.randomUUID(), actor]
    )
  ).rows[0]!.id;

describe.skipIf(!testDatabaseUrl)(
  "administrator account actors migration",
  () => {
    test(
      "preserves legacy actors and applies the new actor constraints",
      async () => {
        const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
        try {
          await withScratchDatabase(
            testDatabaseUrl!,
            "administrator_account_actors",
            async (pool) => {
              await migrate(drizzle({ client: pool }), {
                migrationsFolder: earlierMigrations,
              });

              const pendingRequestId = await insertAuthenticationRequest(
                pool,
                "a"
              );
              const approvedWithoutUsernameId =
                await insertAuthenticationRequest(pool, "b", {
                  approvedBy: null,
                });
              const approvedByLegacyUsernameId =
                await insertAuthenticationRequest(pool, "c", {
                  approvedBy: "legacy.admin",
                });
              const sessionId = (
                await pool.query<{ id: string }>(
                  `insert into cli_sessions (
                     approved_by, token_hash, client_name, cli_version, build_target
                   ) values ('legacy.admin', repeat('d', 43), 'Synthetic CLI', '1.0.0', 'development')
                   returning id`
                )
              ).rows[0]!.id;
              const eventId = await insertAccessCodeEvent(pool, "legacy.admin");

              await migrate(drizzle({ client: pool }), {
                migrationsFolder: workspaceMigrationsFolder,
              });

              const legacyRequests = (
                await pool.query(
                  `select code_hash, approved_at is null as is_pending,
                          approved_by, approved_by_account_id,
                          approved_by_account_email,
                          grant_expires_at is not null as has_grant_expiry
                   from cli_authentication_requests
                   where id = any($1)
                   order by code_hash`,
                  [
                    [
                      pendingRequestId,
                      approvedWithoutUsernameId,
                      approvedByLegacyUsernameId,
                    ],
                  ]
                )
              ).rows;
              expect(legacyRequests).toEqual([
                {
                  code_hash: "a".repeat(43),
                  is_pending: true,
                  approved_by: null,
                  approved_by_account_id: null,
                  approved_by_account_email: null,
                  has_grant_expiry: false,
                },
                {
                  code_hash: "b".repeat(43),
                  is_pending: false,
                  approved_by: null,
                  approved_by_account_id: null,
                  approved_by_account_email: null,
                  has_grant_expiry: true,
                },
                {
                  code_hash: "c".repeat(43),
                  is_pending: false,
                  approved_by: "legacy.admin",
                  approved_by_account_id: null,
                  approved_by_account_email: null,
                  has_grant_expiry: true,
                },
              ]);

              const session = (
                await pool.query(
                  `select approved_by, approved_by_account_id,
                          approved_by_account_email
                   from cli_sessions where id = $1`,
                  [sessionId]
                )
              ).rows[0];
              expect(session).toEqual({
                approved_by: "legacy.admin",
                approved_by_account_id: null,
                approved_by_account_email: null,
              });

              const event = (
                await pool.query(
                  `select event_kind, actor, actor_account_id, actor_account_email
                   from standalone_access_code_attempt_events where id = $1`,
                  [eventId]
                )
              ).rows[0];
              expect(event).toEqual({
                event_kind: "started",
                actor: "legacy.admin",
                actor_account_id: null,
                actor_account_email: null,
              });

              await expect(
                pool.query(
                  `insert into cli_sessions (
                     approved_by, approved_by_account_id, approved_by_account_email,
                     token_hash, client_name, cli_version, build_target
                   ) values (null, null, null, repeat('e', 43), 'Synthetic CLI', '1.0.0', 'development')`
                )
              ).rejects.toMatchObject({
                code: "23514",
                constraint: "cli_sessions_approver_check",
              });

              await expect(
                insertAccessCodeEvent(pool, null)
              ).rejects.toMatchObject({
                code: "23514",
                constraint:
                  "standalone_access_code_attempt_events_actor_present_check",
              });

              const accountId = crypto.randomUUID();
              await pool.query(
                `insert into customer_accounts (id) values ($1) on conflict do nothing`,
                [accountId]
              );
              await pool.query(
                `insert into auth."user" (id, name, email)
                 values ($1, '', $2)`,
                [
                  accountId,
                  testEmailAddress(`administrator-actor-${accountId}`),
                ]
              );
              await expect(
                pool.query(
                  `insert into cli_authentication_requests (
                     code_hash, challenge, client_name, cli_version, build_target,
                     expires_at, approved_at, approved_by_account_id,
                     grant_expires_at
                   ) values (
                     repeat('f', 43), repeat('g', 43), 'Synthetic CLI', '1.0.0',
                     'development', now() + interval '5 minutes', now(), $1,
                     now() + interval '1 hour'
                   )`,
                  [accountId]
                )
              ).rejects.toMatchObject({
                code: "23514",
                constraint:
                  "cli_authentication_requests_approved_by_account_check",
              });
            }
          );
        } finally {
          await rm(earlierMigrations, { recursive: true, force: true });
        }
      },
      { timeout: 60000 }
    );
  }
);
