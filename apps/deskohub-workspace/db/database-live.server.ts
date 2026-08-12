import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Effect, Layer } from "effect";
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

export const WorkspaceDatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeDatabaseClient(pool).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db }))
  )
);
