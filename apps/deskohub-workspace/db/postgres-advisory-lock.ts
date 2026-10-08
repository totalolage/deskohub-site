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

const acquireTransactionLocks = (
  pool: PostgresAdvisoryLockPool,
  keys: readonly PostgresAdvisoryLockKey[]
) =>
  Effect.tryPromise({
    try: async () => {
      const client = await pool.connect();
      try {
        await client.query(beginSql);
        for (const key of keys) {
          await client.query(lockSql, [...key]);
        }
      } catch (cause) {
        client.release(cause instanceof Error ? cause : true);
        throw cause;
      }
      return client;
    },
    catch: toSqlError,
  });

const releaseTransactionLock = Effect.fn(function* (
  client: PostgresAdvisoryLockClient
) {
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
  withPostgresAdvisoryLocks(pool, [key], effect);

/**
 * Acquires multiple transaction-scoped advisory locks on one pinned client
 * and under one pool permit. Callers provide a deterministic global order.
 */
export const withPostgresAdvisoryLocks = <A, E, R>(
  pool: PostgresAdvisoryLockPool,
  keys: readonly PostgresAdvisoryLockKey[],
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError.SqlError, R> =>
  Effect.acquireUseRelease(
    acquireTransactionLocks(pool, keys),
    () => effect,
    releaseTransactionLock
  );

interface IWorkspaceDatabaseAdvisoryLock {
  /**
   * Reserves the shared advisory-lock pool permit around work that performs
   * its advisory locking and local queries inside one database transaction.
   * The effect must open that transaction only after this permit is acquired.
   */
  readonly withTransactionPermit: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
  readonly withLock: <A, E, R>(
    key: PostgresAdvisoryLockKey,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
  readonly withLocks: <A, E, R>(
    keys: readonly PostgresAdvisoryLockKey[],
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
      withTransactionPermit: (effect) => {
        if (semaphore === undefined) {
          return Effect.fail(advisoryLockPoolCapacityError);
        }

        return semaphore.withPermits(1)(effect);
      },
      withLock: (key, effect) => {
        if (semaphore === undefined) {
          return Effect.fail(advisoryLockPoolCapacityError);
        }

        return semaphore.withPermits(1)(
          withPostgresAdvisoryLock(pool, key, effect)
        );
      },
      withLocks: (keys, effect) => {
        if (semaphore === undefined) {
          return Effect.fail(advisoryLockPoolCapacityError);
        }

        return semaphore.withPermits(1)(
          withPostgresAdvisoryLocks(pool, keys, effect)
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
