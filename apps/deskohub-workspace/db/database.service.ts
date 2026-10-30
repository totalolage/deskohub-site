import { Context, Effect, Latch, Layer, Option, Stream } from "effect";
import type { SqlClient, SqlConnection } from "effect/unstable/sql";
import type { DatabaseClient, RootDatabaseClient } from "./database-client";
import type { DatabaseQueryError } from "./sql-constraint";
import { openLockLedger } from "./workspace-lock-ledger";

/**
 * The client the service and its transactions hand out. It has no
 * `transaction`: `WorkspaceDatabase.transaction` is the only way in, and
 * `make` keeps the full client to open it.
 */
export type WorkspaceDatabaseClient = Omit<DatabaseClient, "transaction">;

interface IWorkspaceDatabase {
  /** Inside `transaction`, every statement on `db` joins the open transaction. */
  readonly db: WorkspaceDatabaseClient;
  /**
   * Runs `effect` in one transaction on `db`; inside another transaction on
   * the same client it is a savepoint. Provides `WorkspaceTransaction` and runs
   * `effect` with concurrency 1. A failed COMMIT is a defect, not a failure.
   */
  readonly transaction: <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<
    A,
    E | DatabaseQueryError,
    Exclude<R, WorkspaceTransaction>
  >;
}

/**
 * Present only inside `WorkspaceDatabase.transaction`; `db` is the client
 * that opened it. A writer that must commit with its caller reads `db` from
 * here, which puts this requirement in its type.
 */
export class WorkspaceTransaction extends Context.Service<
  WorkspaceTransaction,
  { readonly db: WorkspaceDatabaseClient }
>()("WorkspaceTransaction") {}

/**
 * Runs a transaction body on a view of the transaction's connection that
 * notices a statement starting while another is still running, or still
 * running when the body ends, and then dies, so the transaction rolls back.
 * When the body ends, the view refuses new statements and waits for running
 * ones, so detached work cannot reach the connection after COMMIT or
 * ROLLBACK. It refuses streamed queries before they reach the connection.
 * Transactional code runs one statement at a time; this catches concurrency
 * the lint rule cannot see, such as a helper in another module that sets its
 * own `concurrency`.
 */
const oneStatementAtATime = <A, E, R>(
  client: SqlClient.SqlClient,
  body: Effect.Effect<A, E, R>
) =>
  Effect.flatMap(Effect.serviceOption(client.transactionService), (open) => {
    if (Option.isNone(open)) return body;
    const [connection, depth] = open.value;
    let running = 0;
    let overlapped = false;
    let ended = false;
    // Open while no statement runs on the view.
    const idle = Latch.makeUnsafe(true);
    const enter = Effect.suspend(() => {
      if (ended) {
        return Effect.die(
          new Error(
            "A statement ran on a Workspace transaction's connection after the transaction's effect ended"
          )
        );
      }
      overlapped ||= running > 0;
      running += 1;
      idle.closeUnsafe();
      return Effect.void;
    });
    const leave = Effect.sync(() => {
      running -= 1;
      if (running === 0) idle.openUnsafe();
    });
    const exclusive = <B, F>(statement: Effect.Effect<B, F>) =>
      Effect.acquireUseRelease(
        enter,
        () => statement,
        () => leave
      );
    const guarded: SqlConnection.Connection = {
      execute: (sql, params, transformRows) =>
        exclusive(connection.execute(sql, params, transformRows)),
      executeRaw: (sql, params) =>
        exclusive(connection.executeRaw(sql, params)),
      executeValues: (sql, params) =>
        exclusive(connection.executeValues(sql, params)),
      executeUnprepared: (sql, params, transformRows) =>
        exclusive(connection.executeUnprepared(sql, params, transformRows)),
      // A stream's reader decides when its statement ends, and may keep it
      // open past the body, so the view could not wait for it.
      executeStream: () =>
        Stream.die(
          new Error(
            "A Workspace transaction refuses streamed queries; read the rows with a query instead"
          )
        ),
    };
    return body.pipe(
      Effect.provideService(client.transactionService, [guarded, depth]),
      // A finalizer, so the view also closes when the fiber is interrupted;
      // interruption skips the `Effect.exit` below. It runs before Effect SQL
      // ends the transaction, so a statement still running finishes inside it.
      Effect.ensuring(
        Effect.suspend(() => {
          ended = true;
          overlapped ||= running > 0;
          return idle.await;
        })
      ),
      Effect.exit,
      Effect.flatMap((exit) =>
        overlapped
          ? Effect.die(
              new Error(
                "Two statements overlapped on a Workspace transaction's connection; run transactional work one statement at a time"
              )
            )
          : exit
      )
    );
  });

export class WorkspaceDatabase extends Context.Service<
  WorkspaceDatabase,
  IWorkspaceDatabase
>()("WorkspaceDatabase") {
  /** Builds the service over a client; production, tests and E2E all use it. */
  static make = (db: RootDatabaseClient): IWorkspaceDatabase => {
    const transaction: IWorkspaceDatabase["transaction"] = (effect) =>
      Effect.flatMap(Effect.serviceOption(WorkspaceTransaction), (open) =>
        // Effect SQL nests only on the client that opened the transaction;
        // another client would BEGIN an independent one on a second
        // connection, which could commit while this one rolls back.
        Option.isSome(open) && open.value.db !== db
          ? Effect.die(
              new Error(
                "A Workspace transaction was opened on a different database client inside another"
              )
            )
          : db.transaction(() => {
              const body = effect.pipe(
                Effect.provideService(
                  WorkspaceTransaction,
                  WorkspaceTransaction.of({ db })
                ),
                Effect.withConcurrency(1),
                // Bounded lock waits nest on this client's own transaction.
                openLockLedger({
                  nested: Option.isSome(open),
                  db,
                  savepoint: transaction,
                })
              );
              // A nested call already runs on the guarded connection.
              return Option.isSome(open)
                ? body
                : oneStatementAtATime(db.$client, body);
            })
      );
    return WorkspaceDatabase.of({ db, transaction });
  };

  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const { workspaceDatabaseLayer } = await import(
        "./database-provider.server"
      );
      return workspaceDatabaseLayer;
    })
  );
}
