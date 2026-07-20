import * as PgClient from "@effect/sql-pg/PgClient";
import { attachDatabasePool } from "@vercel/functions";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import {
  EffectLogger,
  type EffectPgDatabase,
  make,
} from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";
import { Pool } from "pg";
import { env } from "@/env";
import { normalizePostgresConnectionUrl } from "./postgres-connection-url";
import { drizzleRawTypeParsers } from "./postgres-type-parsers";
import { relations } from "./relations";

const pool = new Pool({
  connectionString: normalizePostgresConnectionUrl(env.DATABASE_URL),
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
  types: drizzleRawTypeParsers,
});
attachDatabasePool(pool);

export type WorkspaceDatabaseClient = EffectPgDatabase<typeof relations>;

interface IWorkspaceDatabase {
  readonly db: WorkspaceDatabaseClient;
}

export class WorkspaceDatabase extends Context.Service<
  WorkspaceDatabase,
  IWorkspaceDatabase
>()("WorkspaceDatabase") {}

const PgClientLive = PgClient.layerFrom(
  PgClient.fromPool({ acquire: Effect.succeed(pool) })
).pipe(Layer.orDie);

export const WorkspaceDatabaseLive = Layer.effect(
  WorkspaceDatabase,
  make({ relations }).pipe(
    Effect.provide(Layer.merge(EffectCache.Default, EffectLogger.layer)),
    Effect.map((db) => WorkspaceDatabase.of({ db }))
  )
).pipe(Layer.provide(PgClientLive));
