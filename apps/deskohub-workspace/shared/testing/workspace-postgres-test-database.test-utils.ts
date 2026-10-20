import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";

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

/** The configured test database, migrated once and shared by every suite. */
export const connectWorkspacePostgresTestDatabase =
  (): Promise<WorkspacePostgresTestDatabase | null> =>
    (connection ??= connectConfiguredWorkspacePostgres());

/**
 * Creates an empty sibling database next to the one at `databaseUrl`.
 * `drop` removes it, closing any connections still open to it.
 */
export const createScratchPostgresDatabase = async (
  databaseUrl: string,
  namePrefix: string
) => {
  const name = `${namePrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  const administer = async (statement: string) => {
    const admin = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await admin.query(statement);
    } finally {
      await admin.end();
    }
  };
  await administer(`create database "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: () => administer(`drop database if exists "${name}" with (force)`),
  };
};

/**
 * A migrated database of the suite's own, beside the configured test
 * database. For suites whose subject reads or writes every row of a table,
 * such as the automation engine planning every active automation over every
 * active consent: other suites' rows never reach it, nor its rows theirs.
 * `close` drops it.
 */
export const createWorkspacePostgresSuiteDatabase = async (
  namePrefix: string
): Promise<WorkspacePostgresTestDatabase | null> => {
  const databaseUrl = process.env.WORKSPACE_TEST_DATABASE_URL;
  if (!databaseUrl) return null;
  const scratch = await createScratchPostgresDatabase(databaseUrl, namePrefix);
  try {
    const database = await connectWorkspacePostgres(scratch.url);
    return {
      ...database,
      close: async () => {
        await database.close();
        await scratch.drop();
      },
    };
  } catch (cause) {
    await scratch.drop();
    throw cause;
  }
};
