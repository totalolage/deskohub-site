import { attachDatabasePool } from "@vercel/functions";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";
import {
  type DatabaseClient,
  makeDatabaseClient,
  makeDatabasePool,
} from "./database-client";

const pool = makeDatabasePool({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
});
attachDatabasePool(pool);

export type WorkspaceDatabaseClient = DatabaseClient;

interface IWorkspaceDatabase {
  readonly db: WorkspaceDatabaseClient;
}

export class WorkspaceDatabase extends Context.Service<
  WorkspaceDatabase,
  IWorkspaceDatabase
>()("WorkspaceDatabase") {}

export const WorkspaceDatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeDatabaseClient(pool).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db }))
  )
);
