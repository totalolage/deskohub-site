import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Effect, Layer } from "effect";
import {
  ConnectionError,
  SqlError,
  UnknownError,
} from "effect/unstable/sql/SqlError";
import { env } from "@/env";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";

const pool = makeDatabasePool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
});
attachDatabasePool(pool);

const databaseError = (
  cause: unknown,
  operation: string,
  kind: "connection" | "query"
) =>
  new SqlError({
    reason:
      kind === "connection"
        ? new ConnectionError({ cause, operation })
        : new UnknownError({ cause, operation }),
  });

export const withWorkspaceDatabaseAdvisoryLock = <A, E, R>(
  key: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | SqlError, R> =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => pool.connect(),
      catch: (cause) =>
        databaseError(cause, "acquire-advisory-lock", "connection"),
    }),
    (connection) =>
      Effect.tryPromise({
        try: () =>
          connection.query(
            "select pg_advisory_lock(hashtextextended($1::text, 0))",
            [key]
          ),
        catch: (cause) =>
          databaseError(cause, "acquire-advisory-lock", "query"),
      }).pipe(Effect.andThen(effect)),
    (connection) =>
      Effect.promise(async () => {
        let destroyConnection = true;
        try {
          const result = await connection.query<{ readonly unlocked: boolean }>(
            "select pg_advisory_unlock(hashtextextended($1::text, 0)) as unlocked",
            [key]
          );
          destroyConnection = result.rows[0]?.unlocked !== true;
        } catch {
          // Destroying the session releases every advisory lock it still owns.
        }
        connection.release(destroyConnection);
      })
  );

export const makeWorkspaceDatabaseLayer = () =>
  Layer.effect(
    WorkspaceDatabase,
    makeDatabaseClient(pool).pipe(
      Effect.map((db) => WorkspaceDatabase.of({ db }))
    )
  );
