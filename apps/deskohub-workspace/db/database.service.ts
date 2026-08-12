import { Context } from "effect";
import type { DatabaseClient } from "./database-client";

export type WorkspaceDatabaseClient = DatabaseClient;

interface IWorkspaceDatabase {
  readonly db: WorkspaceDatabaseClient;
}

export class WorkspaceDatabase extends Context.Service<
  WorkspaceDatabase,
  IWorkspaceDatabase
>()("WorkspaceDatabase") {}
