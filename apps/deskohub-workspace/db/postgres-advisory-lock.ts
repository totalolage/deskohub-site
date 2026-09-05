import { Context, Effect, Layer, Result, Semaphore } from "effect";
import { SqlError } from "effect/unstable/sql";
import type { Pool } from "pg";

export type PostgresAdvisoryLockKey = readonly [string, string];

export type PostgresAdvisoryLockClient = {
  readonly query: (sql: string, values?: unknown[]) => Promise<unknown>;
  readonly release: (error?: Error | boolean) => void;
};

export type PostgresAdvisoryLockPool = {
  readonly connect: () => Promise<PostgresAdvisoryLockClient>;
};

const beginSql = "begin";
const lockSql = "select pg_advisory_xact_lock(hashtext($1), hashtext($2))";
const rollbackSql = "rollback";

const toSqlError = (cause: unknown) =>
  new SqlError.SqlError({ reason: new SqlError.UnknownError({ cause }) });

const acquireTransactionLock = (
  pool: PostgresAdvisoryLockPool,
  key: PostgresAdvisoryLockKey
) =>
  Effect.tryPromise({
    try: async () => {
      const client = await pool.connect();
      try {
        await client.query(beginSql);
        await client.query(lockSql, [...key]);
      } catch (cause) {
        client.release(cause instanceof Error ? cause : true);
        throw cause;
      }
      return client;
    },
    catch: toSqlError,
  });

const releaseTransactionLock = (client: PostgresAdvisoryLockClient) =>
  Effect.gen(function* () {
    const rollback = yield* Effect.result(
      Effect.tryPromise({
        try: () => client.query(rollbackSql),
        catch: toSqlError,
      })
    );
    yield* Effect.sync(() =>
      client.release(Result.isFailure(rollback) ? rollback.failure : undefined)
    );
  });

const advisoryLockSemaphores = new WeakMap<Pool, Semaphore.Semaphore>();
const advisoryLockPoolCapacityError = new SqlError.SqlError({
  reason: new SqlError.UnknownError({
    cause: new Error(
      "Postgres advisory lock pool requires at least two connections"
    ),
    message: "Postgres advisory lock pool capacity is too small",
    operation: "withLock",
  }),
});

const makeAdvisoryLockSemaphore = (pool: Pool) => {
  if (pool.options.max < 2) return undefined;

  const existing = advisoryLockSemaphores.get(pool);
  if (existing) return existing;

  const semaphore = Semaphore.makeUnsafe(Math.floor(pool.options.max / 2));
  advisoryLockSemaphores.set(pool, semaphore);
  return semaphore;
};

/**
 * Holds a transaction-scoped PostgreSQL advisory lock inside one explicit
 * write-free transaction on one dedicated pool client while `effect` runs.
 * The open transaction pins the pooled server session to this client, so the
 * lock serializes a durable marker write and a provider call together, and
 * the rollback always ends the transaction, which releases the lock.
 */
export const withPostgresAdvisoryLock = <A, E, R>(
  pool: PostgresAdvisoryLockPool,
  key: PostgresAdvisoryLockKey,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError.SqlError, R> =>
  Effect.acquireUseRelease(
    acquireTransactionLock(pool, key),
    () => effect,
    releaseTransactionLock
  );

interface IWorkspaceDatabaseAdvisoryLock {
  readonly withLock: <A, E, R>(
    key: PostgresAdvisoryLockKey,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
}

export class WorkspaceDatabaseAdvisoryLock extends Context.Service<
  WorkspaceDatabaseAdvisoryLock,
  IWorkspaceDatabaseAdvisoryLock
>()("@deskohub-workspace/db/WorkspaceDatabaseAdvisoryLock") {
  static makeLayer = (pool: Pool) => {
    const semaphore = makeAdvisoryLockSemaphore(pool);

    return Layer.succeed(this, {
      withLock: (key, effect) => {
        if (semaphore === undefined) {
          return Effect.fail(advisoryLockPoolCapacityError);
        }

        return semaphore.withPermits(1)(
          withPostgresAdvisoryLock(pool, key, effect)
        );
      },
    });
  };

  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const { workspaceDatabasePool } = await import(
        "./database-provider.server"
      );
      return WorkspaceDatabaseAdvisoryLock.makeLayer(workspaceDatabasePool);
    })
  );
}
