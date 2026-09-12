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

const insertUser = (id: string) =>
  testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified, created_at, updated_at)
     values ($1, 'Cleanup Fixture', $2, true, now(), now())`,
    [id, `${id}@deskohub.test`]
  );

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
  };
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
  test("deletes exactly the expired sessions, verifications, and stale rate-limit rows", async () => {
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

    const counts = await runSweep(new Date(nowMs));

    expect(counts).toEqual({
      sessions: 1,
      verifications: 1,
      rateLimitRows: 1,
    });
    expect(await countSweepRows(runId)).toEqual({
      sessions: 1,
      verifications: 1,
      rateLimitRows: 1,
    });
  });

  test("is idempotent: the second sweep deletes nothing", async () => {
    const runId = crypto.randomUUID();
    const nowMs = 1_800_100_000_000;

    await runSweep(preSweepNow);

    await insertUser(`user-${runId}`);
    await insertSession(
      `expired-session-${runId}`,
      `user-${runId}`,
      new Date(nowMs - 5_000).toISOString()
    );
    await insertVerification(
      `expired-verification-${runId}`,
      new Date(nowMs - 5_000).toISOString()
    );
    await insertRateLimitRow(
      `stale-rate-limit-${runId}`,
      String(nowMs - 601_000)
    );

    const first = await runSweep(new Date(nowMs));
    expect(first).toEqual({
      sessions: 1,
      verifications: 1,
      rateLimitRows: 1,
    });

    const second = await runSweep(new Date(nowMs));
    expect(second).toEqual({
      sessions: 0,
      verifications: 0,
      rateLimitRows: 0,
    });
    expect(await countSweepRows(runId)).toEqual({
      sessions: 0,
      verifications: 0,
      rateLimitRows: 0,
    });
  });

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
