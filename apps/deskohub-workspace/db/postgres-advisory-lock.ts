import { Context, Effect, Layer, Result } from "effect";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
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
  new SqlError({ reason: new UnknownError({ cause }) });

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
): Effect.Effect<A, E | SqlError, R> =>
  Effect.acquireUseRelease(
    acquireTransactionLock(pool, key),
    () => effect,
    releaseTransactionLock
  );

interface IWorkspaceDatabaseAdvisoryLock {
  readonly withLock: <A, E, R>(
    key: PostgresAdvisoryLockKey,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R>;
}

export class WorkspaceDatabaseAdvisoryLock extends Context.Service<
  WorkspaceDatabaseAdvisoryLock,
  IWorkspaceDatabaseAdvisoryLock
>()("@deskohub-workspace/db/WorkspaceDatabaseAdvisoryLock") {
  static makeLayer = (pool: Pool) =>
    Layer.succeed(this, {
      withLock: (key, effect) => withPostgresAdvisoryLock(pool, key, effect),
    });

  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const { workspaceDatabasePool } = await import(
        "./database-provider.server"
      );
      return WorkspaceDatabaseAdvisoryLock.makeLayer(workspaceDatabasePool);
    })
  );
}
