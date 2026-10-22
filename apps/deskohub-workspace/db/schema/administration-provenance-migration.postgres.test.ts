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

const MIGRATION_DIR = "20261022085235_administration_provenance";
const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

const mutation = JSON.stringify({
  kind: "campaign-duplicate",
  campaignId: "synthetic-campaign",
});

/**
 * The previous deployment's ledger statements, column for column as its
 * Drizzle schema renders them: it knows only `session_id` and inserts with
 * an untargeted `on conflict do nothing`.
 */
const previousDeployment = (pool: Pool, sessionId: string) => ({
  claim: async (requestId: string) =>
    (
      await pool.query<{ request_id: string }>(
        `insert into cli_mutation_requests
           (session_id, request_id, mutation, result, created_at, completed_at)
         values ($1, $2, $3, default, default, default)
         on conflict do nothing
         returning request_id`,
        [sessionId, requestId, mutation]
      )
    ).rows,
  read: async (requestId: string) =>
    (
      await pool.query<{ result: unknown }>(
        `select result from cli_mutation_requests
         where session_id = $1 and request_id = $2 and mutation = $3
         limit 1`,
        [sessionId, requestId, mutation]
      )
    ).rows,
  complete: async (requestId: string) =>
    (
      await pool.query(
        `update cli_mutation_requests
         set result = '{"id":"synthetic"}', completed_at = now()
         where session_id = $1 and request_id = $2 and mutation = $3
           and result is null
         returning request_id`,
        [sessionId, requestId, mutation]
      )
    ).rowCount,
  release: async (requestId: string) =>
    (
      await pool.query(
        `delete from cli_mutation_requests
         where session_id = $1 and request_id = $2 and mutation = $3
           and result is null`,
        [sessionId, requestId, mutation]
      )
    ).rowCount,
});

const insertSession = async (pool: Pool) =>
  (
    await pool.query<{ id: string }>(
      `insert into cli_sessions (
         approved_by, token_hash, client_name, cli_version, build_target
       ) values (
         'legacy.admin', repeat(substr(md5(random()::text), 1, 1), 43),
         'Synthetic CLI', '1.0.0', 'development'
       ) returning id`
    )
  ).rows[0]!.id;

const insertAssistantConnection = async (pool: Pool) => {
  const accountId = crypto.randomUUID();
  await pool.query(`insert into customer_accounts (id) values ($1)`, [
    accountId,
  ]);
  const email = testEmailAddress(`assistant-administrator-${accountId}`);
  await pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [accountId, email]
  );
  return (
    await pool.query<{ id: string }>(
      `insert into administrator_assistant_connections (
         approved_by_account_id, approved_by_account_email, oauth_client_id,
         client_name
       ) values ($1, $2, 'https://assistant.example/client.json', 'Synthetic assistant')
       returning id`,
      [accountId, email]
    )
  ).rows[0]!.id;
};

describe.skipIf(!testDatabaseUrl)("administration provenance migration", () => {
  test(
    "keeps the previous deployment's ledger working and scopes request IDs per channel",
    async () => {
      const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
      try {
        await withScratchDatabase(
          testDatabaseUrl!,
          "administration_provenance",
          async (pool) => {
            await migrate(drizzle({ client: pool }), {
              migrationsFolder: earlierMigrations,
            });
            const sessionId = await insertSession(pool);
            const before = previousDeployment(pool, sessionId);
            const completedId = crypto.randomUUID();
            const pendingId = crypto.randomUUID();
            expect(await before.claim(completedId)).toHaveLength(1);
            expect(await before.complete(completedId)).toBe(1);
            expect(await before.claim(pendingId)).toHaveLength(1);

            await migrate(drizzle({ client: pool }), {
              migrationsFolder: workspaceMigrationsFolder,
            });

            const after = previousDeployment(pool, sessionId);
            // Existing claims still conflict, so retries replay or wait.
            expect(await after.claim(completedId)).toEqual([]);
            expect(await after.read(completedId)).toEqual([
              { result: { id: "synthetic" } },
            ]);
            expect(await after.claim(pendingId)).toEqual([]);
            expect(await after.read(pendingId)).toEqual([{ result: null }]);
            expect(await after.release(pendingId)).toBe(1);
            // New claims behave as before the migration.
            const newId = crypto.randomUUID();
            expect(await after.claim(newId)).toHaveLength(1);
            expect(await after.claim(newId)).toEqual([]);
            expect(await after.complete(newId)).toBe(1);
            expect(await after.complete(newId)).toBe(0);

            const connectionId = await insertAssistantConnection(pool);
            const claimForConnection = async (requestId: string) =>
              (
                await pool.query(
                  `insert into cli_mutation_requests
                     (assistant_connection_id, request_id, mutation)
                   values ($1, $2, $3)
                   on conflict do nothing`,
                  [connectionId, requestId, mutation]
                )
              ).rowCount;
            // The same request ID is a separate request in another channel.
            expect(await claimForConnection(completedId)).toBe(1);
            expect(await claimForConnection(completedId)).toBe(0);
            // The previous deployment never sees an assistant's requests.
            expect(await after.read(completedId)).toEqual([
              { result: { id: "synthetic" } },
            ]);

            await expect(
              pool.query(
                `insert into cli_mutation_requests (request_id, mutation)
                 values ($1, $2)`,
                [crypto.randomUUID(), mutation]
              )
            ).rejects.toMatchObject({
              code: "23514",
              constraint: "cli_mutation_requests_owner_check",
            });
            await expect(
              pool.query(
                `insert into cli_mutation_requests
                   (session_id, assistant_connection_id, request_id, mutation)
                 values ($1, $2, $3, $4)`,
                [sessionId, connectionId, crypto.randomUUID(), mutation]
              )
            ).rejects.toMatchObject({
              code: "23514",
              constraint: "cli_mutation_requests_owner_check",
            });

            await expect(
              pool.query(
                `insert into standalone_access_code_attempt_events (
                   attempt_id, event_kind, actor_account_id,
                   actor_account_email, source, name, device_id,
                   starts_at_local, ends_at_local, starts_at, ends_at,
                   variance, occurred_at
                 ) select
                   $1, 'started', approved_by_account_id,
                   approved_by_account_email, 'assistant',
                   'Synthetic access code', 'synthetic-device',
                   '2026-10-22T10:00', '2026-10-22T11:00',
                   now(), now() + interval '1 hour', 2, now()
                 from administrator_assistant_connections where id = $2`,
                [crypto.randomUUID(), connectionId]
              )
            ).resolves.toMatchObject({ rowCount: 1 });
          }
        );
      } finally {
        await rm(earlierMigrations, { recursive: true, force: true });
      }
    },
    { timeout: 60000 }
  );
});
