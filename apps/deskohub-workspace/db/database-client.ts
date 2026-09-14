import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { type EffectPgDatabase, make } from "drizzle-orm/effect-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Layer } from "effect";
import { Pool, type PoolConfig } from "pg";
import { DatabaseQueryLoggerLive } from "@/shared/backend/logging/database-query-logger";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";
import { drizzleRawTypeParsers } from "./postgres-type-parsers";
import { relations } from "./relations";
import { authRelations } from "./schema/auth";

export type DatabaseClient = EffectPgDatabase<typeof relations>;

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

export const makeDatabaseClient = (pool: Pool) =>
  make({ relations }).pipe(
    Effect.provide(
      Layer.merge(
        PgClient.layerFrom(
          PgClient.fromPool({ acquire: Effect.succeed(pool) })
        ).pipe(Layer.orDie),
        Layer.merge(EffectCache.Default, DatabaseQueryLoggerLive)
      )
    )
  );

export const makeNodePostgresDatabase = (pool: Pool) =>
  drizzle({
    client: pool,
    relations: { ...relations, ...authRelations },
  });
