import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { testEmailAddress } from "@deskohub/test-email";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  linkMigrationsBefore,
  withScratchDatabase,
  workspaceMigrationsFolder,
} from "@/db/migration-scratch-database.test-utils";
import {
  buildDatabaseAdapter,
  HOST,
  makeTestAuth,
  type TestAuth,
  uniqueIp,
} from "./auth-handler.test-utils";

const MIGRATION_DIR = "20261021141443_oauth_token_consent_binding";
const RESOURCE = `https://${HOST}/api/mcp`;
const SCOPES = [
  "offerings:read",
  "reservations:read",
  "reservations:create",
  "offline_access",
];

const testDatabaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;

/** The provider's stored form of a token: unpadded base64url SHA-256. */
const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/**
 * Brings a scratch database to the state production is in before the
 * binding migration, seeds it, applies the remaining migrations, and runs
 * the check against a Workspace auth instance on it.
 */
const migrateAcross = async (
  seed: (pool: Pool) => Promise<void>,
  check: (pool: Pool, auth: TestAuth) => Promise<void>
) => {
  const earlierMigrations = await linkMigrationsBefore(MIGRATION_DIR);
  try {
    await withScratchDatabase(
      testDatabaseUrl!,
      "oauth_token_consent_binding",
      async (pool) => {
        await migrate(drizzle({ client: pool }), {
          migrationsFolder: earlierMigrations,
        });
        await seed(pool);
        await migrate(drizzle({ client: pool }), {
          migrationsFolder: workspaceMigrationsFolder,
        });
        const auth = makeTestAuth({ database: buildDatabaseAdapter(pool) });
        // Startup seeds the MCP resource; it settles before the pool ends.
        await auth.$context;
        await check(pool, auth);
      }
    );
  } finally {
    await rm(earlierMigrations, { recursive: true, force: true });
  }
};

const insertCustomer = async (pool: Pool, id: string) => {
  await pool.query(`insert into customer_accounts (id) values ($1)`, [id]);
  await pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, testEmailAddress(`token-binding-${id}`)]
  );
};

/** A public client linked to the MCP resource, as registration leaves it. */
const insertClient = async (
  pool: Pool,
  clientId: string,
  { skipConsent }: { readonly skipConsent: boolean }
) => {
  await pool.query(
    `insert into auth.oauth_client
       (id, client_id, skip_consent, scopes, redirect_uris,
        token_endpoint_auth_method, grant_types, response_types,
        created_at, updated_at)
     values ($1, $1, $2, $3, $4, 'none',
             '{authorization_code,refresh_token}', '{code}', now(), now())`,
    [clientId, skipConsent, SCOPES, [`https://client.example/${clientId}`]]
  );
  await pool.query(
    `insert into auth.oauth_resource (id, identifier, name, created_at, updated_at)
     values ('mcp', $1, $1, now(), now())
     on conflict (identifier) do nothing`,
    [RESOURCE]
  );
  await pool.query(
    `insert into auth.oauth_client_resource (id, client_id, resource_id, created_at)
     values ($1, $1, $2, now())`,
    [clientId, RESOURCE]
  );
};

/** A consent recorded at `at`, the instant the client's tokens were issued. */
const insertConsent = (
  pool: Pool,
  id: string,
  clientId: string,
  userId: string,
  at: Date
) =>
  pool.query(
    `insert into auth.oauth_consent
       (id, client_id, user_id, scopes, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [id, clientId, userId, SCOPES, at]
  );

/**
 * A refresh token and the access token bought with it, as a deployment
 * before the binding stored them at `at`; returns their raw values.
 */
const insertTokens = async (
  pool: Pool,
  clientId: string,
  userId: string,
  at: Date
) => {
  const access = crypto.randomUUID();
  const refresh = crypto.randomUUID();
  const refreshId = `refresh-${clientId}`;
  await pool.query(
    `insert into auth.oauth_refresh_token
       (id, token, client_id, user_id, resources, scopes, created_at,
        expires_at, auth_time)
     values ($1, $2, $3, $4, $5, $6, $7, $7::timestamptz + interval '30 days', $7)`,
    [refreshId, tokenDigest(refresh), clientId, userId, [RESOURCE], SCOPES, at]
  );
  await pool.query(
    `insert into auth.oauth_access_token
       (id, token, client_id, user_id, refresh_id, resources, scopes,
        created_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8::timestamptz + interval '1 hour')`,
    [
      `access-${clientId}`,
      tokenDigest(access),
      clientId,
      userId,
      refreshId,
      [RESOURCE],
      SCOPES,
      at,
    ]
  );
  return { access, refresh };
};

const consentIdsOf = async (pool: Pool, clientId: string) => {
  const result = await pool.query<{ consent_id: string | null }>(
    `select consent_id from auth.oauth_access_token where client_id = $1
     union all
     select consent_id from auth.oauth_refresh_token where client_id = $1`,
    [clientId]
  );
  return result.rows.map((row) => row.consent_id);
};

const isActive = async (auth: TestAuth, token: string) =>
  (
    (await auth.api.verifyCustomerAgentAccessToken({
      body: { token },
      headers: new Headers({ host: HOST }),
    })) as { readonly active: boolean }
  ).active;

const refresh = (auth: TestAuth, clientId: string, refreshToken: string) =>
  auth.handler(
    new Request(`https://${HOST}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        origin: `https://${HOST}`,
        "x-vercel-forwarded-for": uniqueIp(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        resource: RESOURCE,
      }).toString(),
    })
  );

describe.skipIf(!testDatabaseUrl)(
  "OAuth token consent binding migration on disposable Postgres",
  () => {
    // Timestamps can't prove which consent issued a token: one that outlived
    // a disconnect looks the same as one the consent recorded in the same
    // instant issued, so no existing token is bound and none works again.
    test("leaves existing tokens unbound, so an assistant that asks for consent connects again", async () => {
      const at = new Date(Date.now() - 60_000);
      let tokens: { readonly access: string; readonly refresh: string };
      await migrateAcross(
        async (pool) => {
          await insertCustomer(pool, "customer");
          await insertClient(pool, "asks-consent", { skipConsent: false });
          tokens = await insertTokens(pool, "asks-consent", "customer", at);
          await insertConsent(pool, "consent", "asks-consent", "customer", at);
        },
        async (pool, auth) => {
          expect(await consentIdsOf(pool, "asks-consent")).toEqual([
            null,
            null,
          ]);
          expect(await isActive(auth, tokens.access)).toBe(false);
          const refreshed = await refresh(auth, "asks-consent", tokens.refresh);
          expect(refreshed.status).toBe(400);
          expect(((await refreshed.json()) as { error: string }).error).toBe(
            "invalid_grant"
          );
          expect(await consentIdsOf(pool, "asks-consent")).toEqual([]);
        }
      );
    });

    test("leaves the tokens of a client that skips consent unbound and working after a consent of it goes", async () => {
      const at = new Date(Date.now() - 60_000);
      let tokens: { readonly access: string; readonly refresh: string };
      await migrateAcross(
        async (pool) => {
          await insertCustomer(pool, "customer");
          await insertClient(pool, "skips-consent", { skipConsent: true });
          tokens = await insertTokens(pool, "skips-consent", "customer", at);
          await insertConsent(pool, "consent", "skips-consent", "customer", at);
        },
        async (pool, auth) => {
          expect(await consentIdsOf(pool, "skips-consent")).toEqual([
            null,
            null,
          ]);
          await pool.query(
            `delete from auth.oauth_consent where id = 'consent'`
          );

          expect(await isActive(auth, tokens.access)).toBe(true);
          const refreshed = await refresh(
            auth,
            "skips-consent",
            tokens.refresh
          );
          expect(refreshed.status).toBe(200);
          const renewed = (await refreshed.json()) as {
            readonly access_token: string;
          };
          expect(await isActive(auth, renewed.access_token)).toBe(true);
        }
      );
    });
  }
);
