import { Context, Effect, Layer } from "effect";
import type { DatabaseClient } from "./database-client";

export type WorkspaceDatabaseClient = DatabaseClient;

interface IWorkspaceDatabase {
  readonly db: WorkspaceDatabaseClient;
}

export class WorkspaceDatabase extends Context.Service<
  WorkspaceDatabase,
  IWorkspaceDatabase
>()("WorkspaceDatabase") {
  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const { makeWorkspaceDatabaseLayer } = await import(
        "./database-provider.server"
      );
      return makeWorkspaceDatabaseLayer();
    })
  );
}
