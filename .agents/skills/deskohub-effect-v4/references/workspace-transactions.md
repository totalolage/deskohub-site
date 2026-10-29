# Workspace transactions

## Open a transaction

Open a Workspace transaction only with `transaction` from the database service: `const { db, transaction } = yield* WorkspaceDatabase`, then `transaction(effect)`. A destructured parameter (`Effect.flatMap(WorkspaceDatabase, ({ transaction }) => transaction(effect))`) works too. The `workspace-transaction-entry` rule rejects every other way in: reading `.transaction` or `.withTransaction` off any receiver, called or not (`database.transaction(...)` and `const open = database.transaction` included), and destructuring `transaction` from anything but `yield* WorkspaceDatabase`.

- `WorkspaceDatabaseClient`, the `db` that `WorkspaceDatabase` and `WorkspaceTransaction` hand out, has no `transaction`, so type-checked code has no other way in. `WorkspaceDatabase.make` takes the full client (`RootDatabaseClient`), which test databases and `E2EDatabase` hold.
- Test files aren't type-checked, so the rule covers tests and test utilities in `app/`, `features/` and `shared/` too. A test opens a transaction with `Effect.flatMap(WorkspaceDatabase, ({ db, transaction }) => transaction(effect))` provided with `testDatabase.layer`, or with `Effect.provideService(WorkspaceDatabase, WorkspaceDatabase.make(db))` when it has only a client. Only a test about the raw client suppresses the rule, with a reason. Tests in `db/` exercise the client library and are outside the rule.
- Inside the transaction, every statement on `db` joins it, including statements from other services built from the same `WorkspaceDatabase`. A nested `transaction` is a savepoint: its failure rolls back only its own writes, and the outer effect may catch it and continue.
- A transaction has one connection. Write transactional code sequentially: plain `Effect.all` and `Effect.forEach` with no `concurrency` option at all (not even `1` or `"inherit"`), no `concurrent` option (not even `false`), and no `Effect.withConcurrency`, fork, race or stream merge. The `workspace-transaction-concurrency` rule rejects them anywhere in a file that names `WorkspaceTransaction`, destructures `transaction` or calls `transaction(...)`, sibling functions included. Put fan-out that runs outside every transaction, such as provider reads, in its own module. Do provider calls before or after the transaction, not inside it. When a read under the transaction's locks needs provider state, as referral acceptance does with Dotypos history, call the provider one step at a time.
- The rule sees one file, so keep helpers called from a transaction sequential too. `transaction` runs its effect with concurrency 1, so an `"inherit"` in such a helper runs one at a time. If two statements still run at once on the transaction's connection, `transaction` dies after the effect with "Two statements overlapped…" and rolls back.
- Read rows inside a transaction with queries, not streams. `transaction` refuses a streamed query as a defect before it reaches the connection.
- Nest transactions only on the same `WorkspaceDatabase` client. Opening a transaction of a different client inside one is a defect.
- A failed statement fails with `DatabaseQueryError` and rolls back. A failed COMMIT (for example a deferred constraint) is a defect.

## Write with the caller

A writer whose writes must commit or roll back with its caller reads the client from the transaction: `const { db } = yield* WorkspaceTransaction`. That puts `WorkspaceTransaction` in its requirements, so it cannot run outside a transaction, and `transaction` discharges it. Lock takers do the same.

- Declare it only for those two kinds, plus reads that recheck state after a lock, which are correct only in the locked transaction (the payment lifecycle's admission rechecks). A read, or an idempotent write that is correct on its own, uses the service's `db` and declares nothing; inside a transaction it joins anyway. `ensureCustomerAccount` is such a write.
- Name the writer for what it records, not for the transaction (`recordCustomerEvent`, not `recordCustomerEventInTransaction` or `recordCustomerEventTx`). Don't take a `tx` or `executor` parameter or field, and don't derive a transaction-client type from `transaction`'s callback. A plain query that runs both inside and outside transactions may take the joining client as `db`. The `workspace-transaction-executors` rule enforces the names.
- The requirement proves a writer runs inside a transaction. Its absence proves nothing; say "runs outside a transaction" in a comment.
- Never build or provide `WorkspaceTransaction` yourself, in tests either. Build the service with `WorkspaceDatabase.make(db)`, never `WorkspaceDatabase.of` or an object literal: test files aren't type-checked, so the rule is what catches a hand-built service there. A test that calls a writer runs it in `transaction(...)` on the test database.
- Type assertions about transactions go in a `.typecheck.ts` file, which `tsc` checks.

## Clients that never join

Only `db/`, `e2e/`, `scripts/` and tests build database clients (`workspace-database-clients`). These run outside every Workspace transaction: the Better Auth facade (`db/auth-database-client.ts`), `E2EDatabase`, the E2E coordination `PgClient` layers, and second test pools. Don't call a writer that needs `WorkspaceTransaction` through them.

## Take locks

Take advisory locks with `WorkspaceLocks` (`db/workspace-locks.ts`), inside the transaction. Hold a lock across non-transactional work only with `WorkspaceLockSections`, which hold it on their own connection. Registry operations need `WorkspaceTransaction`. The `workspace-lock-statements` rule rejects advisory-lock SQL, `lock_timeout` and the old statement builders anywhere else in the app.

- Take locks in ascending rank, and equal ranks in ascending key. The registry checks the order at run time. Lock several accounts with `WorkspaceLocks.customerAccounts(ids)`, which sorts them.
- Take a lock out of rank order only with a bounded wait (`{ boundedWait: Duration.seconds(5) }`), and only while every higher-ranked lock you hold is held by an enclosing `WorkspaceLockSections` section; any other out-of-order request is a violation. Expect the wait to fail with a lock timeout (`isLockWaitTimeout`) instead of deadlocking.
- A bounded wait bounds the wait whether the lock is in rank order or not. It runs in a savepoint and restores the transaction's previous `lock_timeout`, so the transaction stays usable after a timeout. A bounded wait must be positive and finite. It rounds up to whole milliseconds, because `lock_timeout` 0 means no timeout.
- Never request a key that an enclosing section holds, and never enter a section inside a transaction: either way you would wait on your own other connection. The first is a defect. The second is a violation, reported as `workspace-lock-section-in-transaction`.
- Violations fail under `bun test` and are logged as `workspace-lock-order` in production until enforcement lands.
- Add a lock by adding a named operation and a rank to the registry. Keep an existing key's encoding byte for byte.
- Open a lock-taking transaction that shares the advisory-lock pool permit as `advisoryLock.withTransactionPermit(transaction(...))`, never with the permit inside the transaction.
