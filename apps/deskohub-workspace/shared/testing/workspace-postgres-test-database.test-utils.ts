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
import { createScratchPostgresDatabase } from "./postgres-scratch-database.test-utils";

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

const connectWorkspacePostgres = async (
  databaseUrl: string
): Promise<WorkspacePostgresTestDatabase> => {
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
    await pool.query("select 1");
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

const connectConfiguredWorkspacePostgres = async () => {
  const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  return databaseUrl ? connectWorkspacePostgres(databaseUrl) : null;
};

/**
 * The configured test database, migrated once and shared by every suite
 * without a database of its own.
 */
export const connectWorkspacePostgresTestDatabase =
  (): Promise<WorkspacePostgresTestDatabase | null> =>
    (connection ??= connectConfiguredWorkspacePostgres());

/**
 * A test database no other suite uses. Helpers whose subject reads or writes
 * every row of a table, such as the automation engine planning every active
 * automation over every active consent, require one.
 */
export interface WorkspacePostgresSuiteDatabase
  extends WorkspacePostgresTestDatabase {
  readonly owner: "suite";
}

/**
 * A migrated database of the suite's own, beside the configured test
 * database: other suites' rows never reach it, nor its rows theirs. Close it
 * in a file-level `afterAll`; `close` drops it.
 */
export const createWorkspacePostgresSuiteDatabase = async (
  namePrefix: string
): Promise<WorkspacePostgresSuiteDatabase | null> => {
  const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  if (!databaseUrl) return null;
  const scratch = await createScratchPostgresDatabase(databaseUrl, namePrefix);
  try {
    const database = await connectWorkspacePostgres(scratch.url);
    return {
      ...database,
      owner: "suite",
      close: async () => {
        try {
          await database.close();
        } finally {
          await scratch.drop();
        }
      },
    };
  } catch (cause) {
    await scratch.drop();
    throw cause;
  }
};
