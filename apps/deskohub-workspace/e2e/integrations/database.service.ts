import { Context, Effect, Layer } from "effect";
import {
  type DatabaseClient,
  makeDatabaseClient,
  makeDatabasePool,
} from "../../db/database-client";
import type { DatasourceConfig } from "../config";
import { tryWorkspaceE2EPromise, tryWorkspaceE2ESync } from "../errors";

interface IE2EDatabase {
  readonly db: DatabaseClient;
}

export class E2EDatabase extends Context.Service<E2EDatabase, IE2EDatabase>()(
  "E2EDatabase"
) {
  static layer = (config: DatasourceConfig) =>
    Layer.effect(
      this,
      Effect.acquireRelease(
        tryWorkspaceE2ESync("create E2E database pool", () =>
          makeDatabasePool({
            connectionString: config.databaseUrlUnpooled,
            connectionTimeoutMillis: config.timeouts.datasource,
            max: 2,
            query_timeout: config.timeouts.datasource,
            statement_timeout: config.timeouts.datasource,
          })
        ),
        (pool) =>
          tryWorkspaceE2EPromise("close E2E database pool", () =>
            pool.end()
          ).pipe(Effect.ignore)
      ).pipe(
        Effect.flatMap(makeDatabaseClient),
        Effect.map((db) => E2EDatabase.of({ db }))
      )
    );
}
