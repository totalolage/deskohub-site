import { Effect } from "effect";
import { Pool, type QueryResultRow } from "pg";
import { normalizePostgresConnectionUrl } from "../../db/postgres-connection-url";
import type { DatasourceConfig } from "../config";
import {
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";

const makePool = (config: DatasourceConfig) =>
  new Pool({
    connectionString: normalizePostgresConnectionUrl(config.databaseUrl),
    connectionTimeoutMillis: config.timeouts.datasource,
    query_timeout: config.timeouts.datasource,
    statement_timeout: config.timeouts.datasource,
  });

export const withPostgresPool = <A>(
  config: DatasourceConfig,
  use: (pool: Pool) => Effect.Effect<A, WorkspaceE2EError>
): Effect.Effect<A, WorkspaceE2EError> =>
  tryWorkspaceE2ESync("create Postgres pool", () => makePool(config)).pipe(
    Effect.flatMap((pool) =>
      use(pool).pipe(
        Effect.ensuring(
          tryWorkspaceE2EPromise("close Postgres pool", () => pool.end()).pipe(
            Effect.ignore
          )
        )
      )
    )
  );

export const queryPostgres = <T extends QueryResultRow>(
  pool: Pool,
  operation: string,
  text: string,
  values: readonly unknown[] = []
) => tryWorkspaceE2EPromise(operation, () => pool.query<T>(text, [...values]));
