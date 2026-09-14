import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Effect, Layer } from "effect";
import { env } from "@/env";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";
import { databasePoolTimeouts } from "./database-pool-timeouts";

export const workspaceDatabasePool = makeDatabasePool({
  connectionString: env.DATABASE_URL,
  ...databasePoolTimeouts,
});

attachDatabasePool(workspaceDatabasePool);

export const workspaceDatabaseLayer = Layer.effect(
  WorkspaceDatabase,
  makeDatabaseClient(workspaceDatabasePool).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db }))
  )
);
