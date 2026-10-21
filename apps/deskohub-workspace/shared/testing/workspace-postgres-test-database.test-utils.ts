import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import type { Pool } from "pg";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { customerAccountIdSchema } from "@/features/account/customer-account";

/**
 * The customer account that authors a fixture reservation naming no author of
 * its own. Every reservation has an author, and the test database always holds
 * this one.
 */
export const fixtureReservationAuthorId = customerAccountIdSchema.make(
  "fixture-reservation-author"
);

export interface WorkspacePostgresTestDatabase {
  readonly db: WorkspaceDatabaseClient;
  readonly layer: Layer.Layer<WorkspaceDatabase>;
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

let connection: Promise<WorkspacePostgresTestDatabase | null> | undefined;

const connectWorkspacePostgres =
  async (): Promise<WorkspacePostgresTestDatabase | null> => {
    const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
    if (!databaseUrl) return null;

    const pool = makeDatabasePool({
      connectionString: databaseUrl,
      ...databasePoolTimeouts,
    });

    const failClosed = async (step: string, cause: unknown): Promise<never> => {
      await pool.end().catch(() => {});
      throw new Error(
        `WORKSPACE_TEST_DATABASE_URL is configured but the disposable Postgres test database ${step}.`,
        { cause }
      );
    };

    try {
      const probeConnection = await pool.connect();
      await probeConnection.query("select 1");
      probeConnection.release();
    } catch (cause) {
      return failClosed("is unreachable", cause);
    }

    try {
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: fileURLToPath(
          new URL("../../db/migrations", import.meta.url)
        ),
      });
    } catch (cause) {
      return failClosed("migration failed", cause);
    }

    await pool.query(
      "insert into customer_accounts (id) values ($1) on conflict do nothing",
      [fixtureReservationAuthorId]
    );

    const db = await Effect.runPromise(makeDatabaseClient(pool));

    return {
      db,
      layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db })),
      pool,
      close: () => pool.end(),
    };
  };

export const connectWorkspacePostgresTestDatabase =
  (): Promise<WorkspacePostgresTestDatabase | null> =>
    (connection ??= connectWorkspacePostgres());
