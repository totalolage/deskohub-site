import { describe, expect, test } from "bun:test";
import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, Exit, Fiber, Layer } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeDatabasePool } from "./database-client";
import { databasePoolTimeouts } from "./database-pool-timeouts";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const probeApplicationName = "deskohub-db-pool-cancellation-test";

const makeProductionStyleProbe = () => {
  const pool = makeDatabasePool({
    connectionString: process.env.WORKSPACE_TEST_DATABASE_URL ?? "",
    ...databasePoolTimeouts,
    statement_timeout: 30_000,
    query_timeout: 500,
    idleTimeoutMillis: 1_000,
    max: 2,
    application_name: probeApplicationName,
  });
  const layer = PgClient.layerFrom(
    PgClient.fromPool({ acquire: Effect.succeed(pool) })
  ).pipe(Layer.orDie);
  return { pool, layer };
};

const activeProbeBackendPids = async (): Promise<number[]> => {
  const result = await postgresDatabase!.pool.query<{
    readonly pid: number;
  }>(
    `select pid
       from pg_stat_activity
      where application_name = $1
        and pid <> pg_backend_pid()
        and query like 'select pg_sleep%'`,
    [probeApplicationName]
  );
  return result.rows.map((row) => row.pid);
};

const isProbeBackendAlive = async (pid: number): Promise<boolean> => {
  const result = await postgresDatabase!.pool.query(
    `select 1
       from pg_stat_activity
      where application_name = $1
        and pid = $2
        and pid <> pg_backend_pid()`,
    [probeApplicationName, pid]
  );
  return result.rowCount === 1;
};

const pollUntilProbeStatementActive = async (): Promise<number> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const pid = (await activeProbeBackendPids())[0];
    if (pid !== undefined) return pid;
    await Bun.sleep(20);
  }
  const pid = (await activeProbeBackendPids())[0];
  if (pid !== undefined) return pid;
  throw new Error("Probe statement did not become active");
};

const observeBackendTeardown = async (pid: number): Promise<boolean> => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (!(await isProbeBackendAlive(pid))) return true;
    await Bun.sleep(100);
  }
  return !(await isProbeBackendAlive(pid));
};

describe.skipIf(!postgresDatabase)(
  "Database pool cancellation against real Postgres",
  () => {
    test("keeps an owned backend visible after its last query changes", async () => {
      const probe = makeProductionStyleProbe();
      let backendPid = 0;
      let signalQueryChanged!: () => void;
      let rejectQueryChanged!: (cause: unknown) => void;
      const queryChanged = new Promise<void>((resolve, reject) => {
        signalQueryChanged = resolve;
        rejectQueryChanged = reject;
      });
      let releaseTransaction!: () => void;
      const transactionGate = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      let transaction: Promise<void> | undefined;

      try {
        transaction = Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const backend = yield* sql<{
                  readonly pid: number;
                }>`select pg_backend_pid()::int as pid`;
                backendPid = backend[0]!.pid;
                yield* sql`select 1 as changed`;
                signalQueryChanged();
                yield* Effect.promise(() => transactionGate);
              })
            );
          }).pipe(Effect.provide(probe.layer), Effect.scoped)
        ).catch((cause: unknown) => {
          rejectQueryChanged(cause);
          throw cause;
        });

        await queryChanged;
        const liveBackend = await postgresDatabase!.pool.query(
          `select pid
             from pg_stat_activity
            where application_name = $1
              and pid = $2
              and pid <> pg_backend_pid()`,
          [probeApplicationName, backendPid]
        );
        expect(liveBackend.rowCount).toBe(1);
        expect(await activeProbeBackendPids()).not.toContain(backendPid);
        expect(await isProbeBackendAlive(backendPid)).toBe(true);
      } finally {
        releaseTransaction();
        await transaction?.catch(() => {});
        await probe.pool.end().catch(() => {});
      }
    });

    test("destroyed lease from an interrupted statement cannot harm other leased statements", async () => {
      const probe = makeProductionStyleProbe();
      try {
        let innocentFailures = 0;
        for (let iteration = 0; iteration < 8; iteration++) {
          const innocentFailed = await Effect.runPromise(
            Effect.gen(function* () {
              const sql = yield* PgClient.PgClient;
              const blocker = yield* Effect.forkChild(
                sql`select pg_sleep(0.03)`
              );
              const victim = yield* Effect.forkChild(
                sql`select pg_sleep(0.01)`
              );
              const innocent = yield* Effect.forkChild(
                Effect.exit(sql`select pg_sleep(0.1)`)
              );
              yield* Effect.sleep("2 millis");
              yield* Fiber.interrupt(victim);
              const innocentExit = yield* Fiber.join(innocent);
              yield* Fiber.join(blocker);
              return Exit.isFailure(innocentExit);
            }).pipe(Effect.provide(probe.layer), Effect.scoped)
          );
          if (innocentFailed) innocentFailures += 1;
        }
        expect(innocentFailures).toBe(0);
      } finally {
        await probe.pool.end().catch(() => {});
      }
    });

    test("query_timeout destroys the standalone lease and the pool recovers", async () => {
      const probe = makeProductionStyleProbe();
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const timedOut = yield* Effect.forkChild(
              sql`select pg_sleep(3)`.pipe(Effect.timeout("4 seconds"))
            );
            const probeBackendPid = yield* Effect.promise(
              pollUntilProbeStatementActive
            );
            const failure = yield* Fiber.await(timedOut);
            const followUpStarted = Date.now();
            const followUp = yield* sql<{
              readonly n: number;
            }>`select 42::int as n`.pipe(Effect.timeout("2 seconds"));
            return {
              failure,
              followUp,
              followUpMillis: Date.now() - followUpStarted,
              probeBackendPid,
            };
          }).pipe(Effect.provide(probe.layer), Effect.scoped)
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.followUp[0]?.n).toBe(42);
        expect(outcome.followUpMillis).toBeLessThan(2_000);
        expect(probe.pool.waitingCount).toBe(0);
        expect(probe.pool.totalCount).toBeLessThanOrEqual(2);
        expect(await observeBackendTeardown(outcome.probeBackendPid)).toBe(
          true
        );
      } finally {
        await probe.pool.end().catch(() => {});
      }
    });

    test("query_timeout inside a transaction destroys the lease without a transaction leak", async () => {
      const probe = makeProductionStyleProbe();
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const started = Date.now();
            const timedOutTx = yield* Effect.forkChild(
              sql
                .withTransaction(sql`select pg_sleep(3)`)
                .pipe(Effect.timeout("4 seconds"))
            );
            const probeBackendPid = yield* Effect.promise(
              pollUntilProbeStatementActive
            );
            const failure = yield* Fiber.await(timedOutTx);
            const failureMillis = Date.now() - started;
            const committed = yield* sql
              .withTransaction(sql<{ readonly n: number }>`select 6 * 7 as n`)
              .pipe(Effect.timeout("2 seconds"));
            return { failure, failureMillis, committed, probeBackendPid };
          }).pipe(Effect.provide(probe.layer), Effect.scoped)
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.failureMillis).toBeLessThan(2_500);
        expect(outcome.committed[0]?.n).toBe(42);
        expect(probe.pool.waitingCount).toBe(0);
        expect(await observeBackendTeardown(outcome.probeBackendPid)).toBe(
          true
        );
      } finally {
        await probe.pool.end().catch(() => {});
      }
    });

    test("an interrupted transaction destroys its lease exactly once without a transaction leak", async () => {
      const probe = makeProductionStyleProbe();
      try {
        const outcome = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            const started = Date.now();
            const interruptedTx = yield* Effect.forkChild(
              sql
                .withTransaction(sql`select pg_sleep(3)`)
                .pipe(Effect.timeout("250 millis"))
            );
            const probeBackendPid = yield* Effect.promise(
              pollUntilProbeStatementActive
            );
            const failure = yield* Fiber.await(interruptedTx);
            const failureMillis = Date.now() - started;
            const committed = yield* sql
              .withTransaction(sql<{ readonly n: number }>`select 7 * 6 as n`)
              .pipe(Effect.timeout("2 seconds"));
            return { failure, failureMillis, committed, probeBackendPid };
          }).pipe(Effect.provide(probe.layer), Effect.scoped)
        );

        expect(Exit.isFailure(outcome.failure)).toBe(true);
        expect(outcome.failureMillis).toBeLessThan(2_500);
        expect(outcome.committed[0]?.n).toBe(42);
        expect(probe.pool.waitingCount).toBe(0);
        expect(await observeBackendTeardown(outcome.probeBackendPid)).toBe(
          true
        );
      } finally {
        await probe.pool.end().catch(() => {});
      }
    });

    test("runs plain statements, commits, and rollbacks through the external pool", async () => {
      const probe = makeProductionStyleProbe();
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient;
            yield* sql`create table if not exists database_pool_cancellation_probe (n int)`;
            yield* sql`truncate database_pool_cancellation_probe`;
            const plain = yield* sql<{
              readonly n: number;
            }>`select 41 + 1 as n`;
            const committed = yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`insert into database_pool_cancellation_probe values (1)`;
                return yield* sql<{ readonly n: number }>`select 7 * 6 as n`;
              })
            );
            yield* sql
              .withTransaction(
                Effect.gen(function* () {
                  yield* sql`insert into database_pool_cancellation_probe values (2)`;
                  return yield* Effect.fail("rollback requested" as const);
                })
              )
              .pipe(Effect.catch(() => Effect.void));
            const remaining = yield* sql<{
              readonly n: number;
            }>`select count(*)::int as n from database_pool_cancellation_probe`;
            return { plain, committed, remaining };
          }).pipe(Effect.provide(probe.layer), Effect.scoped)
        );

        expect(result.plain[0]?.n).toBe(42);
        expect(result.committed[0]?.n).toBe(42);
        expect(result.remaining[0]?.n).toBe(1);
      } finally {
        await probe.pool.end().catch(() => {});
      }
    });
  }
);
