import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { type EffectPgDatabase, make } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { Pool, type PoolConfig } from "pg";
import { DatabaseQueryLoggerLive } from "@/shared/backend/logging/database-query-logger";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";
import { drizzleRawTypeParsers } from "./postgres-type-parsers";
import { relations } from "./relations";

export type DatabaseClient = EffectPgDatabase<typeof relations>;

/**
 * A client over its own SQL client (`makeDatabaseClient`, Drizzle's `make`),
 * as opposed to a transaction's executor. `WorkspaceDatabase.make` takes one.
 */
export type RootDatabaseClient = DatabaseClient & {
  readonly $client: SqlClient.SqlClient;
};

export const makeDatabasePool = (
  config: Omit<PoolConfig, "connectionString" | "types"> & {
    readonly connectionString: string;
  }
) =>
  new Pool({
    ...config,
    connectionString: normalizePostgresConnectionUrl(config.connectionString),
    types: drizzleRawTypeParsers,
  });

/**
 * The services a database client runs on: the Postgres client the layer
 * provides, the query cache, and the query logger.
 */
export const databaseClientServices = <E>(
  postgres: Layer.Layer<PgClient.PgClient, E>
) =>
  Layer.merge(
    postgres.pipe(Layer.orDie),
    Layer.merge(EffectCache.Default, DatabaseQueryLoggerLive)
  );

export const makeDatabaseClient = (pool: Pool) =>
  make({ relations }).pipe(
    Effect.provide(
      databaseClientServices(
        PgClient.layerFrom(PgClient.fromPool({ acquire: Effect.succeed(pool) }))
      )
    )
  );
