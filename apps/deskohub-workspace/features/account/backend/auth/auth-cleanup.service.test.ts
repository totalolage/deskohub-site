import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type AuthCleanupFailure,
  AuthCleanupService,
} from "./auth-cleanup.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const insertUser = async (id: string) => {
  await testDatabase!.pool.query(
    "insert into customer_accounts (id) values ($1) on conflict do nothing",
    [id]
  );
  return testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Cleanup Fixture', $2, true, now(), now())`,
    [id, testEmailAddress(`${id}`)]
  );
};

const insertSession = (id: string, userId: string, expiresAt: string) =>
  testDatabase!.pool.query(
    `insert into auth.session (id, expires_at, token, created_at, updated_at, user_id)
     values ($1, $2::timestamptz, $3, now(), now(), $4)`,
    [id, expiresAt, `token-${id}`, userId]
  );

const insertVerification = (id: string, expiresAt: string) =>
  testDatabase!.pool.query(
    `insert into auth.verification (id, identifier, value, expires_at, created_at, updated_at)
     values ($1, $2, '{}', $3::timestamptz, now(), now())`,
    [id, `identifier-${id}`, expiresAt]
  );

const insertRateLimitRow = (id: string, lastRequestEpochMs: string) =>
  testDatabase!.pool.query(
    `insert into auth.rate_limit (id, key, count, last_request)
     values ($1, $2, 3, $3::bigint)`,
    [id, `key-${id}`, lastRequestEpochMs]
  );

const insertAgentClient = (id: string) =>
  testDatabase!.pool.query(
    `insert into auth.oauth_client (id, client_id, redirect_uris, created_at, updated_at)
     values ($1, $2, array['https://agent.example/callback'], now(), now())`,
    [id, `https://agent.example/${id}`]
  );

const insertAgentRefreshToken = (
  id: string,
  clientId: string,
  userId: string,
  expiresAt: string
) =>
  testDatabase!.pool.query(
    `insert into auth.oauth_refresh_token (id, token, client_id, user_id, scopes, expires_at, created_at)
     values ($1, $2, $3, $4, array['reservations:read'], $5::timestamptz, now())`,
    [id, `hash-${id}`, `https://agent.example/${clientId}`, userId, expiresAt]
  );

/**
 * A rotated, unexpired refresh token that keeps an encrypted replay response
 * until `replayExpiresAt`; it stays for reuse detection.
 */
const insertRotatedAgentRefreshToken = (
  id: string,
  clientId: string,
  userId: string,
  expiresAt: string,
  replayExpiresAt: string | null
) =>
  testDatabase!.pool.query(
    `insert into auth.oauth_refresh_token (id, token, client_id, user_id, scopes, expires_at, created_at, revoked, rotated_at, rotation_replay_response, rotation_replay_expires_at)
     values ($1, $2, $3, $4, array['reservations:read'], $5::timestamptz, now(), now(), now(), 'encrypted-replay', $6::timestamptz)`,
    [
      id,
      `hash-${id}`,
      `https://agent.example/${clientId}`,
      userId,
      expiresAt,
      replayExpiresAt,
    ]
  );

const countStoredReplays = async (runId: string) => {
  const result = await testDatabase!.pool.query(
    `select count(*)::int as count from auth.oauth_refresh_token
     where id like $1 and rotation_replay_response is not null`,
    [`%${runId}`]
  );
  return result.rows[0]!.count as number;
};

const insertAgentAccessToken = (
  id: string,
  clientId: string,
  userId: string,
  expiresAt: string,
  refreshId: string | null = null
) =>
  testDatabase!.pool.query(
    `insert into auth.oauth_access_token (id, token, client_id, user_id, refresh_id, scopes, expires_at, created_at)
     values ($1, $2, $3, $4, $5, array['reservations:read'], $6::timestamptz, now())`,
    [
      id,
      `hash-${id}`,
      `https://agent.example/${clientId}`,
      userId,
      refreshId,
      expiresAt,
    ]
  );

const insertAgentClientAssertion = (id: string, expiresAt: string) =>
  testDatabase!.pool.query(
    `insert into auth.oauth_client_assertion (id, expires_at)
     values ($1, $2::timestamptz)`,
    [id, expiresAt]
  );

const insertCustomerAccount = (id: string, createdAt: string) =>
  testDatabase!.pool.query(
    `insert into customer_accounts (id, created_at)
     values ($1, $2::timestamptz) on conflict (id) do nothing`,
    [id, createdAt]
  );

const readAccountDeletions = async (runId: string) => {
  const result = await testDatabase!.pool.query<{
    id: string;
    deleted: boolean;
  }>(
    `select id, deleted_at is not null as deleted from customer_accounts
     where id like $1 order by id`,
    [`%${runId}`]
  );
  return Object.fromEntries(
    result.rows.map(({ id, deleted }) => [id.replace(`-${runId}`, ""), deleted])
  );
};

const countSweepRows = async (runId: string) => {
  const count = async (table: string) => {
    const result = await testDatabase!.pool.query(
      `select count(*)::int as count from auth."${table}" where id like $1`,
      [`%${runId}`]
    );
    return result.rows[0]!.count as number;
  };
  return {
    sessions: await count("session"),
    verifications: await count("verification"),
    rateLimitRows: await count("rate_limit"),
    agentAccessTokens: await count("oauth_access_token"),
    agentRefreshTokens: await count("oauth_refresh_token"),
    agentClientAssertions: await count("oauth_client_assertion"),
  };
};

const noAgentRows = {
  agentAccessTokens: 0,
  agentRefreshTokens: 0,
  agentClientAssertions: 0,
};

const runSweep = (now: Date) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cleanup = yield* AuthCleanupService;
      return yield* cleanup.deleteExpiredRows({ now });
    }).pipe(Effect.provide(AuthCleanupService.Live))
  );

/**
 * A now so far in the future that the pre-sweep deletes every ordinary
 * fixture of any earlier test, making each test's counted sweep independent
 * of leftover rows and of run order.
 */
const preSweepNow = new Date(Date.parse("2999-01-01T00:00:00Z"));

describe.skipIf(!testDatabase)("AuthCleanupService", () => {
  test("deletes exactly the expired sessions, verifications, and stale rate-limit rows and tombstones settled login-less accounts", async () => {
    const runId = crypto.randomUUID();
    const nowMs = 1_800_000_000_000;

    await runSweep(preSweepNow);

    await insertUser(`user-${runId}`);
    await insertSession(
      `expired-session-${runId}`,
      `user-${runId}`,
      new Date(nowMs - 1).toISOString()
    );
    await insertSession(
      `fresh-session-${runId}`,
      `user-${runId}`,
      new Date(nowMs + 30 * 86_400_000).toISOString()
    );
    await insertVerification(
      `expired-verification-${runId}`,
      new Date(nowMs - 1).toISOString()
    );
    await insertVerification(
      `fresh-verification-${runId}`,
      new Date(nowMs + 30 * 86_400_000).toISOString()
    );
    await insertRateLimitRow(
      `stale-rate-limit-${runId}`,
      String(nowMs - 601_000)
    );
    await insertRateLimitRow(
      `boundary-rate-limit-${runId}`,
      String(nowMs - 600_000)
    );

    await insertCustomerAccount(
      `user-${runId}`,
      new Date(nowMs - 2 * 86_400_000).toISOString()
    );
    await insertCustomerAccount(
      `settled-orphan-${runId}`,
      new Date(nowMs - 86_400_001).toISOString()
    );
    await insertCustomerAccount(
      `recent-orphan-${runId}`,
      new Date(nowMs - 86_400_000).toISOString()
    );

    const counts = await runSweep(new Date(nowMs));

    expect(counts).toEqual({
      sessions: 1,
      verifications: 1,
      rateLimitRows: 1,
      ...noAgentRows,
      agentRefreshReplays: 0,
      orphanedAccounts: 1,
    });
    expect(await readAccountDeletions(runId)).toEqual({
      "recent-orphan": false,
      "settled-orphan": true,
      user: false,
    });
    expect(await countSweepRows(runId)).toEqual({
      sessions: 1,
      verifications: 1,
      rateLimitRows: 1,
      ...noAgentRows,
    });
  });

  test("deletes exactly the expired agent tokens and client assertions", async () => {
    const runId = crypto.randomUUID();
    const nowMs = 1_800_000_000_000;
    const expired = new Date(nowMs - 1).toISOString();
    const atNow = new Date(nowMs).toISOString();
    const live = new Date(nowMs + 3_600_000).toISOString();
    const userId = `agent-user-${runId}`;
    const clientId = `agent-client-${runId}`;

    await runSweep(preSweepNow);

    await insertUser(userId);
    await insertAgentClient(clientId);
    await insertAgentRefreshToken(
      `expired-refresh-${runId}`,
      clientId,
      userId,
      expired
    );
    await insertAgentRefreshToken(
      `live-refresh-${runId}`,
      clientId,
      userId,
      live
    );
    await insertAgentAccessToken(
      `expired-access-${runId}`,
      clientId,
      userId,
      expired
    );
    await insertAgentAccessToken(
      `boundary-access-${runId}`,
      clientId,
      userId,
      atNow
    );
    await insertAgentAccessToken(
      `live-access-${runId}`,
      clientId,
      userId,
      live,
      `live-refresh-${runId}`
    );
    await insertAgentClientAssertion(`expired-assertion-${runId}`, expired);
    await insertAgentClientAssertion(`live-assertion-${runId}`, live);

    const counts = await runSweep(new Date(nowMs));

    expect(counts).toMatchObject({
      agentAccessTokens: 2,
      agentRefreshTokens: 1,
      agentClientAssertions: 1,
    });
    expect(await countSweepRows(runId)).toMatchObject({
      agentAccessTokens: 1,
      agentRefreshTokens: 1,
      agentClientAssertions: 1,
    });
  });

  test("clears refresh replay responses whose reuse window has passed, keeping the rotated tokens", async () => {
    const runId = crypto.randomUUID();
    const nowMs = 1_800_000_000_000;
    const live = new Date(nowMs + 30 * 86_400_000).toISOString();
    const userId = `replay-user-${runId}`;
    const clientId = `replay-client-${runId}`;

    await runSweep(preSweepNow);

    await insertUser(userId);
    await insertAgentClient(clientId);
    await insertRotatedAgentRefreshToken(
      `past-replay-${runId}`,
      clientId,
      userId,
      live,
      new Date(nowMs - 1).toISOString()
    );
    await insertRotatedAgentRefreshToken(
      `undated-replay-${runId}`,
      clientId,
      userId,
      live,
      null
    );
    await insertRotatedAgentRefreshToken(
      `boundary-replay-${runId}`,
      clientId,
      userId,
      live,
      new Date(nowMs).toISOString()
    );
    await insertRotatedAgentRefreshToken(
      `open-replay-${runId}`,
      clientId,
      userId,
      live,
      new Date(nowMs + 30_000).toISOString()
    );

    const counts = await runSweep(new Date(nowMs));

    expect(counts).toMatchObject({
      agentRefreshTokens: 0,
      agentRefreshReplays: 2,
    });
    expect(await countSweepRows(runId)).toMatchObject({
      agentRefreshTokens: 4,
    });
    expect(await countStoredReplays(runId)).toBe(2);
  });
});

describe("AuthCleanupService failures", () => {
  test("reports a fixed censored failure without the raw database error", async () => {
    const failure = new Error("sensitive relation and constraint details");
    const failingDb = {
      delete: () => ({
        where: () => ({
          returning: () => Effect.fail(failure),
        }),
      }),
    } as never;
    const failingDatabase = Layer.succeed(
      WorkspaceDatabase,
      WorkspaceDatabase.of({ db: failingDb })
    );

    const failingService = AuthCleanupService.Default.pipe(
      Layer.provide(failingDatabase)
    );

    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const cleanup = yield* AuthCleanupService;
        return yield* cleanup
          .deleteExpiredRows({ now: new Date() })
          .pipe(Effect.result);
      }).pipe(Effect.provide(failingService))
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      const failure = outcome.failure as AuthCleanupFailure;
      expect(failure._tag).toBe("AuthCleanupFailure");
      expect(failure.code).toBe("account.cleanup.unavailable");
      expect(JSON.stringify(failure)).not.toContain("sensitive relation");
    }
  });
});
