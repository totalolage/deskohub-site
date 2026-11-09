import "@/shared/testing/workspace-test-env";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Latch,
  Option,
  Ref,
  References,
  Stream,
} from "effect";
import {
  createWorkspacePostgresSuiteDatabase,
  withHeldTransaction,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { WorkspaceDatabase, WorkspaceTransaction } from "./database.service";
import { makeDatabaseClient, makeDatabasePool } from "./database-client";

const suiteDatabase = await createWorkspacePostgresSuiteDatabase(
  "workspace_transaction"
);

describe.skipIf(!suiteDatabase)(
  "Workspace transactions on disposable Postgres",
  () => {
    if (!suiteDatabase) return;
    const { db, pool } = suiteDatabase;
    const database = WorkspaceDatabase.make(db);
    const { transaction } = database;

    beforeAll(async () => {
      await pool.query(
        "create table workspace_transaction_probe (label text primary key)"
      );
      await pool.query(
        `create table workspace_transaction_deferred_probe (
        id integer primary key,
        parent integer references workspace_transaction_deferred_probe (id)
          deferrable initially deferred
      )`
      );
    });

    afterAll(() => suiteDatabase.close());

    const insertWith = (client: typeof db, label: string) =>
      client.execute(
        sql`insert into workspace_transaction_probe (label) values (${label})`
      );

    /** A writer that must commit with its caller: it reads the client from the marker. */
    const recordProbe = (label: string) =>
      Effect.gen(function* () {
        const { db: client } = yield* WorkspaceTransaction;
        yield* insertWith(client, label);
      }); // Effect<void, DatabaseQueryError, WorkspaceTransaction>

    const labels = async (prefix: string) =>
      (
        await pool.query<{ label: string }>(
          "select label from workspace_transaction_probe where label like $1 order by label",
          [`${prefix}%`]
        )
      ).rows.map(({ label }) => label);

    /** Reads through the open transaction's client. */
    const labelsInTransaction = (prefix: string) =>
      Effect.map(
        db.execute<{ label: string }>(
          sql`select label from workspace_transaction_probe where label like ${`${prefix}%`}`
        ),
        (result) => result.rows
      );

    const lockKey = (name: string) =>
      [`workspace-transaction-test`, name] as const;
    const takeLock = (name: string) =>
      db.execute(
        sql`select pg_advisory_xact_lock(hashtext(${lockKey(name)[0]}), hashtext(${lockKey(name)[1]}))`
      );
    /** Whether another session can take the key now (it releases it at once). */
    const lockFreeElsewhere = (name: string) =>
      Effect.promise(async () => {
        const other = await pool.connect();
        try {
          const { rows } = await other.query<{ free: boolean }>(
            "select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as free",
            [...lockKey(name)]
          );
          return rows[0]!.free;
        } finally {
          other.release();
        }
      });

    test("joins a requirement writer, the captured client and a second service lookup", async () => {
      const prefix = `join-${crypto.randomUUID()}`;
      await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* recordProbe(`${prefix}-writer`);
            yield* insertWith(db, `${prefix}-captured`);
            const looked = yield* WorkspaceDatabase;
            yield* insertWith(looked.db, `${prefix}-service`);
            expect((yield* WorkspaceTransaction).db).toBe(db);
            expect(yield* labelsInTransaction(prefix)).toHaveLength(3);
          })
        ).pipe(Effect.provideService(WorkspaceDatabase, database))
      );
      expect(await labels(prefix)).toHaveLength(3);
    });

    test("rolls back every write when the transaction fails, and the pool stays usable", async () => {
      const prefix = `rollback-${crypto.randomUUID()}`;
      const exit = await Effect.runPromiseExit(
        transaction(
          Effect.gen(function* () {
            yield* recordProbe(`${prefix}-writer`);
            yield* insertWith(db, `${prefix}-captured`);
            const looked = yield* WorkspaceDatabase;
            yield* insertWith(looked.db, `${prefix}-service`);
            yield* transaction(recordProbe(`${prefix}-nested`));
            return yield* Effect.fail("abort" as const);
          })
        ).pipe(Effect.provideService(WorkspaceDatabase, database))
      );
      expect(exit).toStrictEqual(Exit.fail("abort"));
      expect(await labels(prefix)).toEqual([]);
      await Effect.runPromise(transaction(recordProbe(`${prefix}-after`)));
      expect(await labels(prefix)).toEqual([`${prefix}-after`]);
    });

    test("a nested transaction is a savepoint", async () => {
      const prefix = `savepoint-${crypto.randomUUID()}`;
      await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* recordProbe(`${prefix}-a-outer`);
            yield* transaction(
              recordProbe(`${prefix}-b-failed`).pipe(
                Effect.andThen(Effect.fail("inner" as const))
              )
            ).pipe(Effect.catch(() => Effect.void));
            yield* transaction(recordProbe(`${prefix}-c-succeeded`));
          })
        )
      );
      expect(await labels(prefix)).toEqual([
        `${prefix}-a-outer`,
        `${prefix}-c-succeeded`,
      ]);
    });

    test("runs inherited concurrency one effect at a time inside, and not outside", async () => {
      const interleaving = Effect.gen(function* () {
        const log = yield* Ref.make<ReadonlyArray<string>>([]);
        const step = (name: string) =>
          Ref.update(log, (entries) => [...entries, `${name}:start`]).pipe(
            Effect.andThen(Effect.sleep("20 millis")),
            Effect.andThen(
              Ref.update(log, (entries) => [...entries, `${name}:end`])
            )
          );
        yield* Effect.all([step("a"), step("b")], { concurrency: "inherit" });
        return {
          log: yield* Ref.get(log),
          limit: yield* References.CurrentConcurrency,
        };
      });

      const inside = await Effect.runPromise(transaction(interleaving));
      expect(inside).toEqual({
        log: ["a:start", "a:end", "b:start", "b:end"],
        limit: 1,
      });
      const outside = await Effect.runPromise(interleaving);
      expect(outside.log).toEqual(["a:start", "b:start", "a:end", "b:end"]);
    });

    test("dies when two statements overlap on its connection, and nothing commits", async () => {
      const prefix = `overlap-${crypto.randomUUID()}`;
      // Like a helper in another module that sets its own limit: the lint rule
      // cannot see it, and an explicit limit overrides concurrency 1.
      const writeBoth = Effect.all(
        [recordProbe(`${prefix}-a`), recordProbe(`${prefix}-b`)],
        { concurrency: 2 }
      );
      for (const run of [
        transaction(writeBoth),
        transaction(transaction(writeBoth)),
      ]) {
        const exit = await Effect.runPromiseExit(run);
        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
        expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
          "Two statements overlapped"
        );
      }

      // A failing sibling may interrupt a running statement; the driver then
      // drops the connection, so only the outcome is fixed, not the message.
      const failing = await Effect.runPromiseExit(
        transaction(
          Effect.all(
            [
              recordProbe(`${prefix}-c`),
              recordProbe(`${prefix}-c`),
              recordProbe(`${prefix}-d`),
            ],
            { concurrency: 3 }
          )
        )
      );
      expect(Exit.isFailure(failing)).toBe(true);
      expect(await labels(prefix)).toEqual([]);
      await Effect.runPromise(transaction(recordProbe(`${prefix}-after`)));
      expect(await labels(prefix)).toEqual([`${prefix}-after`]);
    });

    test("refuses statements from work that outlives the transaction", async () => {
      const prefix = `detached-${crypto.randomUUID()}`;
      const release = await Effect.runPromise(Deferred.make<void>());
      const lateFibers: Array<Fiber.Fiber<unknown, unknown>> = [];
      const forkLate = (label: string) =>
        Effect.forkDetach(
          Deferred.await(release).pipe(
            Effect.andThen(recordProbe(`${prefix}-${label}`))
          )
        ).pipe(Effect.tap((late) => Effect.sync(() => lateFibers.push(late))));
      const success = await Effect.runPromiseExit(
        transaction(forkLate("success"))
      );
      const failure = await Effect.runPromiseExit(
        transaction(
          forkLate("failure").pipe(
            Effect.andThen(Effect.fail("abort" as const))
          )
        )
      );
      const defect = await Effect.runPromiseExit(
        transaction(
          forkLate("defect").pipe(Effect.andThen(Effect.die("abort")))
        )
      );
      const nested = await Effect.runPromiseExit(
        transaction(transaction(forkLate("nested")))
      );
      expect(Exit.isSuccess(success) && Exit.isSuccess(nested)).toBe(true);
      expect(failure).toStrictEqual(Exit.fail("abort"));
      expect(Exit.isFailure(defect) && Cause.hasDies(defect.cause)).toBe(true);
      // Every transaction has ended; only now does the detached work run.
      await Effect.runPromise(Deferred.succeed(release, undefined));
      expect(lateFibers).toHaveLength(4);
      for (const late of lateFibers) {
        const exit = await Effect.runPromiseExit(Fiber.join(late));
        expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
          "after the transaction's effect ended"
        );
      }
      expect(await labels(prefix)).toEqual([]);
    });

    test("refuses statements from work that outlives an interrupted transaction", async () => {
      const prefix = `interrupted-${crypto.randomUUID()}`;
      const release = await Effect.runPromise(Deferred.make<void>());
      const forked = await Effect.runPromise(
        Deferred.make<Fiber.Fiber<unknown, unknown>>()
      );
      const running = Effect.runFork(
        transaction(
          recordProbe(`${prefix}-body`).pipe(
            Effect.andThen(
              Effect.forkDetach(
                Deferred.await(release).pipe(
                  Effect.andThen(recordProbe(`${prefix}-late`))
                )
              )
            ),
            Effect.flatMap((late) => Deferred.succeed(forked, late)),
            Effect.andThen(Effect.never)
          )
        )
      );
      const late = await Effect.runPromise(Deferred.await(forked));
      // `Fiber.interrupt` returns once the fiber has ended, after its ROLLBACK
      // and the connection's release; only then does the detached work run.
      await Effect.runPromise(Fiber.interrupt(running));
      const interrupted = await Effect.runPromise(Fiber.await(running));
      expect(
        Exit.isFailure(interrupted) &&
          Cause.hasInterruptsOnly(interrupted.cause)
      ).toBe(true);
      await Effect.runPromise(Deferred.succeed(release, undefined));
      const exit = await Effect.runPromiseExit(Fiber.join(late));
      expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
        "after the transaction's effect ended"
      );
      expect(await labels(prefix)).toEqual([]);
    });

    test("waits for a statement admitted before the body ended, so it runs inside the rolled-back transaction", async () => {
      const prefix = `admitted-${crypto.randomUUID()}`;
      const lateLabel = `${prefix}-late`;
      // One connection, so the next transaction borrows the one this one used.
      const gatedPool = makeDatabasePool({
        connectionString: pool.options.connectionString!,
        max: 1,
      });
      // Opens when the late INSERT reaches the connection, past the view.
      const reached = Latch.makeUnsafe(false);
      // Holds the late INSERT back from `pg`, as a scheduler yield between
      // admission and sending could; opens at the first COMMIT or ROLLBACK,
      // or when the test opens it.
      const gate = Latch.makeUnsafe(false);
      const sent: Array<unknown> = [];
      gatedPool.on("connect", (client) => {
        const query = client.query.bind(client) as (
          ...args: Array<unknown>
        ) => unknown;
        Object.assign(client, {
          query: (...args: Array<unknown>) => {
            const [text, values] = args;
            if (Array.isArray(values) && values.includes(lateLabel)) {
              reached.openUnsafe();
              Effect.runFork(
                gate.await.pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      sent.push("late");
                      query(...args);
                    })
                  )
                )
              );
              return undefined;
            }
            const result = query(...args);
            if (text === "COMMIT" || text === "ROLLBACK") {
              sent.push(text);
              gate.openUnsafe();
            }
            return result;
          },
        });
      });
      try {
        const gatedDb = await Effect.runPromise(makeDatabaseClient(gatedPool));
        const gated = WorkspaceDatabase.make(gatedDb);
        const lateFibers: Array<Fiber.Fiber<unknown, unknown>> = [];
        const running = Effect.runFork(
          gated.transaction(
            Effect.gen(function* () {
              yield* insertWith(gatedDb, `${prefix}-body`);
              lateFibers.push(
                yield* Effect.forkDetach(insertWith(gatedDb, lateLabel))
              );
              // The late statement is admitted and running; the body ends
              // before `pg` has it.
              yield* reached.await;
            })
          )
        );
        await Effect.runPromise(reached.await);
        // The transaction cannot end while the late statement is held.
        const endedWhileHeld = await Effect.runPromise(
          Fiber.await(running).pipe(Effect.timeoutOption("1 second"))
        );
        gate.openUnsafe();
        const exit = await Effect.runPromise(Fiber.await(running));
        expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(
          "Two statements overlapped"
        );
        expect(lateFibers).toHaveLength(1);
        expect(
          Exit.isSuccess(
            await Effect.runPromiseExit(Fiber.join(lateFibers[0]!))
          )
        ).toBe(true);
        expect(await labels(prefix)).toEqual([]);

        // The pool's one connection serves the next transaction cleanly.
        await Effect.runPromise(
          gated.transaction(insertWith(gatedDb, `${prefix}-next`))
        );
        expect(await labels(prefix)).toEqual([`${prefix}-next`]);
        expect(sent).toEqual(["late", "ROLLBACK", "COMMIT"]);
        expect(Option.isNone(endedWhileHeld)).toBe(true);
      } finally {
        await gatedPool.end();
      }
    });

    test("refuses a streamed query before it reaches the connection", async () => {
      const prefix = `stream-${crypto.randomUUID()}`;
      const { streamed, visible } = await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            const streamed = yield* Effect.exit(
              Stream.runCollect(
                db.$client.unsafe(
                  "insert into workspace_transaction_probe (label) values ($1) returning label",
                  [`${prefix}-streamed`]
                ).stream
              )
            );
            const visible = yield* labelsInTransaction(prefix);
            yield* recordProbe(`${prefix}-after`);
            return { streamed, visible };
          })
        )
      );
      expect(Exit.isFailure(streamed) && Cause.hasDies(streamed.cause)).toBe(
        true
      );
      expect(
        Exit.isFailure(streamed) && Cause.pretty(streamed.cause)
      ).toContain("refuses streamed queries");
      expect(visible).toEqual([]);
      expect(await labels(prefix)).toEqual([`${prefix}-after`]);
    });

    test("dies when another client's transaction opens inside, and that client never joins", async () => {
      const prefix = `foreign-${crypto.randomUUID()}`;
      const otherDb = await Effect.runPromise(makeDatabaseClient(pool));
      const other = WorkspaceDatabase.make(otherDb);

      const nested = await Effect.runPromiseExit(
        transaction(other.transaction(recordProbe(`${prefix}-nested`)))
      );
      expect(Exit.isFailure(nested) && Cause.hasDies(nested.cause)).toBe(true);

      const escaped = await Effect.runPromiseExit(
        transaction(
          insertWith(otherDb, `${prefix}-escaped`).pipe(
            Effect.andThen(Effect.fail("abort" as const))
          )
        )
      );
      expect(escaped).toStrictEqual(Exit.fail("abort"));
      expect(await labels(prefix)).toEqual([`${prefix}-escaped`]);
    });

    test("releases an advisory lock taken in a savepoint when the savepoint rolls back", async () => {
      await Effect.runPromise(
        transaction(
          Effect.gen(function* () {
            yield* transaction(
              takeLock("rolled-back").pipe(
                Effect.andThen(Effect.fail("inner" as const))
              )
            ).pipe(Effect.catch(() => Effect.void));
            expect(yield* lockFreeElsewhere("rolled-back")).toBe(true);

            yield* transaction(takeLock("released"));
            expect(yield* lockFreeElsewhere("released")).toBe(false);
          })
        )
      );
      expect(await Effect.runPromise(lockFreeElsewhere("released"))).toBe(true);
    });

    test("a constraint that fails at COMMIT is a defect and leaves nothing behind", async () => {
      const id = Math.floor(Math.random() * 1_000_000_000);
      const exit = await Effect.runPromiseExit(
        transaction(
          db.execute(
            sql`insert into workspace_transaction_deferred_probe (id, parent) values (${id}, ${id + 1})`
          )
        )
      );
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(Exit.isFailure(exit) && Cause.hasFails(exit.cause)).toBe(false);
      const { rows } = await pool.query(
        "select 1 from workspace_transaction_deferred_probe where id = $1",
        [id]
      );
      expect(rows).toEqual([]);
      await Effect.runPromise(transaction(db.execute(sql`select 1`)));
    });

    test("inside a held test transaction, a transaction is a savepoint the held rollback removes", async () => {
      const prefix = `held-${crypto.randomUUID()}`;
      const connection = await pool.connect();
      try {
        await connection.query("begin");
        await Effect.runPromise(
          withHeldTransaction(connection, (heldDb) =>
            WorkspaceDatabase.make(heldDb).transaction(
              recordProbe(`${prefix}-held`)
            )
          )
        );
        const { rows } = await connection.query(
          "select label from workspace_transaction_probe where label like $1",
          [`${prefix}%`]
        );
        expect(rows).toHaveLength(1);
        await connection.query("rollback");
      } finally {
        connection.release();
      }
      expect(await labels(prefix)).toEqual([]);
    });
  }
);
