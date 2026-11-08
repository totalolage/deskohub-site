import { Effect, Layer } from "effect";
import type { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";

export interface UnreachableWorkspaceDatabase {
  readonly database: Layer.Layer<WorkspaceDatabase>;
  readonly advisoryLock: Layer.Layer<WorkspaceDatabaseAdvisoryLock>;
  /** End it when the test is done. */
  readonly pool: Pool;
}

/**
 * A Workspace database whose every statement and lock fails with a real
 * connection error: nothing listens on port 1.
 */
export const connectUnreachableWorkspaceDatabase =
  async (): Promise<UnreachableWorkspaceDatabase> => {
    const pool = makeDatabasePool({
      connectionString: "postgres://workspace:workspace@127.0.0.1:1/workspace",
      ...databasePoolTimeouts,
    });
    const db = await Effect.runPromise(makeDatabaseClient(pool));
    return {
      database: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
      advisoryLock: WorkspaceDatabaseAdvisoryLock.makeLayer(pool),
      pool,
    };
  };
