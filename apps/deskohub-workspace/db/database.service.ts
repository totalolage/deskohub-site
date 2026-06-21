import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Data, Effect, Layer } from "effect";
import { Pool } from "pg";
import { env } from "@/env";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";
import * as schema from "./schema";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

const pool = new Pool({
  connectionString: normalizePostgresConnectionUrl(env.DATABASE_URL),
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
});
attachDatabasePool(pool);

export const workspaceDb = drizzle(pool, { schema });

export type WorkspaceDatabaseClient = typeof workspaceDb;

export interface WorkspaceDatabase {
  readonly db: WorkspaceDatabaseClient;
}

export const WorkspaceDatabase =
  Context.Service<WorkspaceDatabase>("WorkspaceDatabase");

export const WorkspaceDatabaseLive = Layer.succeed(
  WorkspaceDatabase,
  WorkspaceDatabase.of({ db: workspaceDb })
);

export interface RunDbOptions<E> {
  readonly preserveError?: (cause: unknown) => cause is E;
}

export const mapDatabaseError =
  <E>(operation: string, options?: RunDbOptions<E>) =>
  (cause: unknown): DatabaseError | E => {
    if (options?.preserveError?.(cause)) {
      return cause;
    }

    return new DatabaseError({ operation, cause });
  };

export const runDb = <A, E = never>(
  operation: string,
  run: () => Promise<A>,
  options?: RunDbOptions<E>
): Effect.Effect<A, DatabaseError | E> =>
  Effect.tryPromise({ try: run, catch: mapDatabaseError(operation, options) });
