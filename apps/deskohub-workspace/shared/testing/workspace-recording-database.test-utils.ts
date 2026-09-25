import { Effect, Layer, Predicate } from "effect";
import { Pool, type QueryResult } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient } from "@/db/database-client";

export interface RecordedStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export interface RecordingWorkspaceDatabase {
  readonly statements: readonly RecordedStatement[];
  readonly layer: Layer.Layer<WorkspaceDatabase>;
  /** Queues one canned result per upcoming statement; the last entry repeats. */
  readonly setRows: (rows: (readonly unknown[])[]) => void;
  readonly failNextQueriesWith: (cause: unknown, count: number) => void;
}

type QueryCallback = (error: Error | null, result: QueryResult) => void;

const emptyQueryResult = (rows: readonly unknown[]): QueryResult =>
  ({
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  }) as QueryResult;

/**
 * Builds the real workspace drizzle client over a recording stub pool so tests
 * execute the actual query-builder layer and assert on the compiled SQL and
 * bound parameters without needing a live Postgres server.
 */
export const makeRecordingWorkspaceDatabase =
  async (): Promise<RecordingWorkspaceDatabase> => {
    const statements: RecordedStatement[] = [];
    let rowsQueue: (readonly unknown[])[] = [];
    let failures: { readonly cause: unknown; remaining: number } | undefined;

    const nextRows = (): readonly unknown[] =>
      rowsQueue.length > 1 ? (rowsQueue.shift() ?? []) : (rowsQueue[0] ?? []);

    const transactionControlPattern = /^(begin|commit|rollback)\b/i;

    const runStatement = (
      text: string,
      values: readonly unknown[]
    ): QueryResult => {
      if (failures && failures.remaining > 0) {
        failures.remaining -= 1;
        throw failures.cause;
      }
      const rows = transactionControlPattern.test(text) ? [] : nextRows();
      statements.push({ sql: text, params: values });
      return emptyQueryResult(rows);
    };

    const clientQuery = (
      query:
        | string
        | { readonly text: string; readonly values?: readonly unknown[] },
      valuesOrCallback?: readonly unknown[] | QueryCallback,
      maybeCallback?: QueryCallback
    ): QueryResult | undefined => {
      const callback = Predicate.isFunction(valuesOrCallback)
        ? valuesOrCallback
        : maybeCallback;
      const values = Predicate.isFunction(valuesOrCallback)
        ? []
        : (valuesOrCallback ?? []);
      const text = Predicate.isString(query) ? query : query.text;
      const statementValues =
        Predicate.isString(query) || !Predicate.hasProperty(query, "values")
          ? values
          : (query.values ?? []);

      if (callback) {
        try {
          callback(null, runStatement(text, statementValues));
        } catch (cause) {
          callback(
            cause instanceof Error ? cause : new Error(String(cause)),
            emptyQueryResult([])
          );
        }
        return undefined;
      }
      return runStatement(text, statementValues);
    };

    interface RecordingPoolClient {
      readonly query: typeof clientQuery;
      readonly release: () => void;
      readonly on: () => void;
      readonly once: () => void;
      readonly off: () => void;
      readonly removeListener: () => void;
    }

    type RecordingPoolConnect = (
      callback?: (
        error: Error | undefined,
        client: RecordingPoolClient | undefined,
        done?: () => void
      ) => void
    ) => void;

    // A real Pool only dials the server when connect() runs, so replacing
    // connect keeps construction type-safe without any live connection.
    // @effect/sql-pg acquires clients with the callback connect style.
    const pool = new Pool({ connectionString: "postgres://unused" });
    const connectedClient = (): RecordingPoolClient => ({
      query: clientQuery,
      release: () => {},
      on: () => {},
      once: () => {},
      off: () => {},
      removeListener: () => {},
    });
    const stubConnect: RecordingPoolConnect = (callback) => {
      if (!callback) return;
      queueMicrotask(() => callback(undefined, connectedClient(), () => {}));
    };
    pool.connect = stubConnect as Pool["connect"];

    const db = await Effect.runPromise(makeDatabaseClient(pool));

    return {
      statements,
      layer: Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db })),
      setRows: (next) => {
        rowsQueue = next;
      },
      failNextQueriesWith: (cause, count) => {
        failures = { cause, remaining: count };
      },
    };
  };
