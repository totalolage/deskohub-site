import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { Effect, Layer } from "effect";
import { env } from "@/env";
import { WorkspaceDatabase } from "./database.service";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";
import { databasePoolTimeouts } from "./database-pool-timeouts";

const pool = makeDatabasePool({
  connectionString: env.DATABASE_URL,
  ...databasePoolTimeouts,
});
attachDatabasePool(pool);

export const makeWorkspaceDatabaseLayer = () =>
  Layer.effect(
    WorkspaceDatabase,
    makeDatabaseClient(pool).pipe(
      Effect.map((db) => WorkspaceDatabase.of({ db }))
    )
  );
