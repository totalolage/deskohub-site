import { Context, Effect, Layer } from "effect";
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

const lockSql = "select pg_advisory_lock(hashtext($1), hashtext($2))";
const unlockSql = "select pg_advisory_unlock(hashtext($1), hashtext($2))";

const toSqlError = (cause: unknown) =>
  new SqlError({ reason: new UnknownError({ cause }) });

const acquireSessionLock = (
  pool: PostgresAdvisoryLockPool,
  key: PostgresAdvisoryLockKey
) =>
  Effect.tryPromise({
    try: async () => {
      const client = await pool.connect();
      try {
        await client.query(lockSql, [...key]);
      } catch (cause) {
        client.release(cause instanceof Error ? cause : true);
        throw cause;
      }
      return client;
    },
    catch: toSqlError,
  });

const releaseSessionLock = (
  client: PostgresAdvisoryLockClient,
  key: PostgresAdvisoryLockKey
) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => client.query(unlockSql, [...key]),
      catch: toSqlError,
    }).pipe(Effect.ignore);
    yield* Effect.sync(() => client.release());
  });

/**
 * Holds a session-level PostgreSQL advisory lock on one dedicated pool client
 * while `effect` runs. The lock survives independent transactions so a durable
 * marker write and a provider call can be serialized together, and it is
 * released automatically when the client session ends.
 */
export const withPostgresAdvisoryLock = <A, E, R>(
  pool: PostgresAdvisoryLockPool,
  key: PostgresAdvisoryLockKey,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R> =>
  Effect.acquireUseRelease(
    acquireSessionLock(pool, key),
    () => effect,
    (client) => releaseSessionLock(client, key)
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
