import { fileURLToPath } from "node:url";
import * as PgClient from "@effect/sql-pg/PgClient";
import { make } from "drizzle-orm/effect-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Effect, Layer } from "effect";
import { Client, type Pool, type PoolClient } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  databaseClientServices,
  makeDatabaseClient,
  makeDatabasePool,
  type RootDatabaseClient,
} from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import { relations } from "@/db/relations";
import { createScratchPostgresDatabase } from "./postgres-scratch-database.test-utils";
import { fixtureReservationAuthorId } from "./workspace-fixtures.test-utils";

export interface WorkspacePostgresTestDatabase {
  readonly db: RootDatabaseClient;
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
    layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.make(db)),
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

/**
 * Runs `use` with a database client that writes inside the transaction the
 * connection holds open, such as one a test began with `begin` to keep its
 * rows uncommitted. The client's own transactions become savepoints named
 * `effect_sql_<depth>`, so the test's commit or rollback decides every write.
 * Run its transactions one after another: concurrent ones share a savepoint
 * name. The test keeps owning the connection and its transaction, and
 * releases it.
 */
export const withHeldTransaction = <A, E, R>(
  connection: PoolClient,
  use: (db: RootDatabaseClient) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const db = yield* make({ relations });
    const held = yield* db.$client.reserve;
    return yield* use(db).pipe(
      Effect.provideService(db.$client.transactionService, [held, 0])
    );
  }).pipe(
    Effect.scoped,
    Effect.provide(
      databaseClientServices(
        PgClient.layerFrom(
          PgClient.fromClient({
            // A pool's connections are `pg` Clients; `PoolClient` only hides
            // the connection settings PgClient reads.
            acquire:
              connection instanceof Client
                ? Effect.succeed(connection)
                : Effect.die(new TypeError("Expected a pg Client connection")),
            acquireForStream: false,
          })
        )
      )
    )
  );
