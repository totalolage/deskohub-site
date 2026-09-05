import { describe, expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { SqlError } from "effect/unstable/sql";
import { Pool } from "pg";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { makeDatabasePool } from "./database-client";
import { databasePoolTimeouts } from "./database-pool-timeouts";
import {
  type PostgresAdvisoryLockClient,
  type PostgresAdvisoryLockKey,
  type PostgresAdvisoryLockPool,
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "./postgres-advisory-lock";

const key: PostgresAdvisoryLockKey = ["test-namespace", "resource-1"];

const makeFakePool = (options?: {
  readonly failAcquire?: boolean;
  readonly failRollback?: boolean;
}) => {
  const queries: string[] = [];
  const released: (Error | boolean | undefined)[] = [];
  let connected = 0;

  const client: PostgresAdvisoryLockClient = {
    query: (text: string) => {
      queries.push(text);
      if (options?.failRollback && text.includes("rollback")) {
        return Promise.reject(new Error("rollback went wrong"));
      }
      return Promise.resolve({ rows: [] });
    },
    release: (error?: Error | boolean) => {
      released.push(error);
    },
  };

  const pool: PostgresAdvisoryLockPool = {
    connect: () => {
      connected += 1;
      if (options?.failAcquire) {
        return Promise.reject(new Error("pool exhausted"));
      }
      return Promise.resolve(client);
    },
  };

  return {
    pool,
    queries,
    released,
    get connected() {
      return connected;
    },
  };
};

const makeLayerPool = (max: number) => {
  const fake = makeFakePool();
  const pool = new Pool({
    connectionString: "postgres://unused",
    max,
  });
  pool.connect = fake.pool.connect as Pool["connect"];
  return {
    pool,
    queries: fake.queries,
    released: fake.released,
    get connected() {
      return fake.connected;
    },
  };
};

const runLayerLock = <A, E, R>(
  layer: ReturnType<typeof WorkspaceDatabaseAdvisoryLock.makeLayer>,
  lockKey: PostgresAdvisoryLockKey,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
    return yield* advisoryLock.withLock(lockKey, effect);
  }).pipe(Effect.provide(layer));

const makeTransactionPoolingPostgres = (serverSessionCount: number) => {
  type FakeServerSession = {
    readonly id: number;
    readonly sessionLocks: Set<string>;
    readonly transactionLocks: Set<string>;
    inTransaction: boolean;
  };

  const sessions: FakeServerSession[] = Array.from(
    { length: serverSessionCount },
    (_, id) => ({
      id,
      sessionLocks: new Set<string>(),
      transactionLocks: new Set<string>(),
      inTransaction: false,
    })
  );

  const routed: {
    readonly statement: string;
    readonly serverSession: number;
  }[] = [];

  let nextIdleSession = 0;

  const lockIdentity = (values?: unknown[]) =>
    (values ?? []).map((value) => String(value)).join("\u0000");

  const routeStatementToIdleSession = () => {
    const session = sessions[nextIdleSession % sessions.length]!;
    nextIdleSession += 1;
    return session;
  };

  const heldElsewhere = (session: FakeServerSession, identity: string) =>
    sessions.some(
      (other) =>
        other !== session &&
        (other.sessionLocks.has(identity) ||
          other.transactionLocks.has(identity))
    );

  const acquireAdvisoryLock = (
    session: FakeServerSession,
    scope: Set<string>,
    identity: string
  ): Promise<unknown> => {
    if (heldElsewhere(session, identity)) {
      return new Promise<never>(() => undefined);
    }
    scope.add(identity);
    return Promise.resolve({ rows: [] });
  };

  const makeProxyClient = (): PostgresAdvisoryLockClient => {
    let pinnedSession: FakeServerSession | undefined;

    return {
      query: (text, values) => {
        const statement = text.trim().toLowerCase();

        if (statement === "begin") {
          const session = sessions.find(
            (candidate) => !candidate.inTransaction
          );
          if (!session) {
            return Promise.reject(new Error("no idle server session"));
          }
          session.inTransaction = true;
          pinnedSession = session;
          routed.push({ statement, serverSession: session.id });
          return Promise.resolve({ rows: [] });
        }

        if (statement === "commit" || statement === "rollback") {
          const session = pinnedSession;
          pinnedSession = undefined;
          if (session) {
            session.inTransaction = false;
            session.transactionLocks.clear();
          }
          routed.push({ statement, serverSession: session?.id ?? -1 });
          return Promise.resolve({ rows: [] });
        }

        const session = pinnedSession ?? routeStatementToIdleSession();
        routed.push({ statement, serverSession: session.id });

        if (statement.includes("pg_advisory_xact_lock")) {
          return acquireAdvisoryLock(
            session,
            session.transactionLocks,
            lockIdentity(values)
          );
        }
        if (statement.includes("pg_advisory_lock")) {
          return acquireAdvisoryLock(
            session,
            session.sessionLocks,
            lockIdentity(values)
          );
        }
        if (statement.includes("pg_advisory_unlock")) {
          session.sessionLocks.delete(lockIdentity(values));
          return Promise.resolve({ rows: [{ pg_advisory_unlock: false }] });
        }
        return Promise.resolve({ rows: [] });
      },
      release: () => {},
    };
  };

  const pool: PostgresAdvisoryLockPool = {
    connect: () => Promise.resolve(makeProxyClient()),
  };

  return {
    pool,
    routed,
    serverSessions: sessions,
    serverSessionsHoldingLock: () =>
      sessions
        .filter(
          (session) =>
            session.sessionLocks.size > 0 || session.transactionLocks.size > 0
        )
        .map((session) => session.id),
  };
};

describe("Postgres advisory lock helper", () => {
  test("holds the advisory lock in one explicit transaction, rolls the transaction back, then releases the client", async () => {
    const fake = makeFakePool();

    const result = await Effect.runPromise(
      withPostgresAdvisoryLock(fake.pool, key, Effect.succeed("inside"))
    );

    expect(result).toBe("inside");
    expect(fake.queries).toEqual([
      "begin",
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      "rollback",
    ]);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeUndefined();
  });

  test("releases the advisory lock at transaction end so the next same-key scope does not stall under transaction pooling", async () => {
    const fake = makeTransactionPoolingPostgres(3);
    const mutexKey: PostgresAdvisoryLockKey = ["account-pooler", "profile-1"];

    const firstScope = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, mutexKey, Effect.succeed("first"))
    );

    expect(Exit.isSuccess(firstScope)).toBe(true);
    expect(fake.serverSessionsHoldingLock()).toEqual([]);

    const [begin, lock, rollback] = fake.routed;
    expect(begin?.statement).toBe("begin");
    expect(lock?.statement).toBe(
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))"
    );
    expect(rollback?.statement).toBe("rollback");
    expect(begin?.serverSession).toBe(lock?.serverSession);
    expect(lock?.serverSession).toBe(rollback?.serverSession);

    const secondScope = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(
        fake.pool,
        mutexKey,
        Effect.succeed("second")
      ).pipe(Effect.timeout("1 second"))
    );

    expect(Exit.isSuccess(secondScope)).toBe(true);
    expect(fake.serverSessionsHoldingLock()).toEqual([]);
  });

  test("releases the client when the guarded effect fails", async () => {
    const fake = makeFakePool();
    const failure = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(
        fake.pool,
        key,
        Effect.fail(new Error("inside failure"))
      )
    );

    expect(failure._tag).toBe("Failure");
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries[2]).toBe("rollback");
    expect(fake.released).toHaveLength(1);
  });

  test("releases the client when the guarded effect is interrupted", async () => {
    const fake = makeFakePool();
    const interruption = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, key, Effect.interrupt)
    );

    expect(interruption._tag).toBe("Failure");
    expect(fake.queries).toHaveLength(3);
    expect(fake.queries[2]).toBe("rollback");
    expect(fake.released).toHaveLength(1);
  });

  test("maps pool acquisition failures to a SQL error and never releases", async () => {
    const fake = makeFakePool({ failAcquire: true });
    const error = await Effect.runPromise(
      withPostgresAdvisoryLock(
        fake.pool,
        key,
        Effect.succeed("unreachable")
      ).pipe(Effect.flip)
    );

    expect((error as { _tag?: string })._tag).toBe("SqlError");
    expect(fake.queries).toHaveLength(0);
    expect(fake.released).toHaveLength(0);
  });

  test("evicts the pooled client when the rollback fails", async () => {
    const fake = makeFakePool({ failRollback: true });

    const result = await Effect.runPromise(
      withPostgresAdvisoryLock(fake.pool, key, Effect.succeed("inside"))
    );

    expect(result).toBe("inside");
    expect(fake.queries).toHaveLength(3);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
    expect((fake.released[0] as { _tag?: string })._tag).toBe("SqlError");
  });

  test("keeps the guarded effect's failure when the rollback also fails", async () => {
    const fake = makeFakePool({ failRollback: true });
    const insideFailure = new Error("inside failure");

    const exit = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, key, Effect.fail(insideFailure))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(insideFailure);
    }
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
  });

  test("fails closed when the pool cannot leave a query connection available", async () => {
    const fake = makeLayerPool(1);

    try {
      const error = await Effect.runPromise(
        runLayerLock(
          WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool),
          ["capacity", "one"],
          Effect.succeed("unreachable")
        ).pipe(Effect.flip)
      );

      expect(SqlError.isSqlError(error)).toBe(true);
      if (SqlError.isSqlError(error)) {
        expect(error.message).toBe(
          "Postgres advisory lock pool capacity is too small"
        );
      }
      expect(fake.connected).toBe(0);
    } finally {
      await fake.pool.end();
    }
  });

  test("shares one gate across layers for the same pool and holds it through transaction cleanup", async () => {
    const fake = makeLayerPool(2);
    const firstLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool);
    const secondLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool);
    const events: string[] = [];

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const first = yield* Effect.forkChild(
            runLayerLock(
              firstLayer,
              ["layers", "first"],
              Effect.gen(function* () {
                events.push("first-entered");
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
                events.push("first-left");
              })
            )
          );

          yield* Deferred.await(firstEntered);

          const second = yield* Effect.forkChild(
            runLayerLock(
              secondLayer,
              ["layers", "second"],
              Effect.sync(() => {
                expect(fake.released).toHaveLength(1);
                events.push("second-entered");
              })
            )
          );

          yield* Effect.sleep("10 millis");
          expect(events).toEqual(["first-entered"]);
          yield* Deferred.succeed(releaseFirst, undefined);
          yield* Fiber.join(first);
          yield* Fiber.join(second);
        })
      );

      expect(events).toEqual(["first-entered", "first-left", "second-entered"]);
      expect(fake.released).toHaveLength(2);
    } finally {
      await fake.pool.end();
    }
  });

  test("releases the gate after a guarded effect fails", async () => {
    const fake = makeLayerPool(2);
    const layer = WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool);

    try {
      const failure = await Effect.runPromiseExit(
        runLayerLock(
          layer,
          ["release", "failure"],
          Effect.fail("inside failure" as const)
        )
      );
      expect(Exit.isFailure(failure)).toBe(true);

      const result = await Effect.runPromise(
        runLayerLock(
          layer,
          ["release", "failure-next"],
          Effect.succeed("released")
        )
      );
      expect(result).toBe("released");
    } finally {
      await fake.pool.end();
    }
  });

  test("releases the gate after a guarded effect is interrupted", async () => {
    const fake = makeLayerPool(2);
    const layer = WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool);

    try {
      const interruption = await Effect.runPromiseExit(
        runLayerLock(layer, ["release", "interruption"], Effect.interrupt)
      );
      expect(Exit.isFailure(interruption)).toBe(true);

      await expect(
        Effect.runPromise(
          runLayerLock(
            layer,
            ["release", "interruption-next"],
            Effect.succeed("released")
          )
        )
      ).resolves.toBe("released");
    } finally {
      await fake.pool.end();
    }
  });

  test("interrupting a waiting lock leaves the gate available", async () => {
    const fake = makeLayerPool(2);
    const layer = WorkspaceDatabaseAdvisoryLock.makeLayer(fake.pool);

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const firstEntered = yield* Deferred.make<void>();
          const releaseFirst = yield* Deferred.make<void>();
          const first = yield* Effect.forkChild(
            runLayerLock(
              layer,
              ["wait", "first"],
              Effect.gen(function* () {
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
              })
            )
          );

          yield* Deferred.await(firstEntered);
          const waiter = yield* Effect.forkChild(
            runLayerLock(
              layer,
              ["wait", "second"],
              Effect.fail("interrupted waiter entered" as const)
            )
          );

          yield* Effect.sleep("10 millis");
          expect(fake.connected).toBe(1);
          yield* Fiber.interrupt(waiter);
          expect(Exit.isFailure(yield* Fiber.await(waiter))).toBe(true);
          yield* Deferred.succeed(releaseFirst, undefined);
          yield* Fiber.join(first);
        })
      );

      const result = await Effect.runPromise(
        runLayerLock(layer, ["wait", "third"], Effect.succeed("available"))
      );
      expect(result).toBe("available");
    } finally {
      await fake.pool.end();
    }
  });
});

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "Postgres advisory lock against real Postgres",
  () => {
    for (const max of [2, 4] as const) {
      test(`keeps callbacks usable with a bounded pool of ${max}`, async () => {
        const pool = makeDatabasePool({
          connectionString: process.env.WORKSPACE_TEST_DATABASE_URL!,
          ...databasePoolTimeouts,
          connectionTimeoutMillis: 250,
          max,
        });
        const layer = WorkspaceDatabaseAdvisoryLock.makeLayer(pool);

        try {
          const results = await Promise.all(
            Array.from({ length: 10 }, (_, index) =>
              Effect.runPromise(
                runLayerLock(
                  layer,
                  ["bounded-pool", `resource-${index}`],
                  Effect.promise(() => pool.query("select 1"))
                )
              )
            )
          );

          expect(results).toHaveLength(10);
          expect(results.every((result) => result.rows.length === 1)).toBe(
            true
          );

          const unrelated = await pool.query("select 1");
          expect(unrelated.rows).toHaveLength(1);
          expect(pool.waitingCount).toBe(0);
          expect(pool.idleCount).toBe(pool.totalCount);
          expect(pool.totalCount).toBeLessThanOrEqual(max);
        } finally {
          await pool.end();
        }

        expect(pool.waitingCount).toBe(0);
        expect(pool.idleCount).toBe(0);
        expect(pool.totalCount).toBe(0);
      });
    }

    test("serializes concurrent holders of the same key", async () => {
      const { pool } = postgresDatabase!;
      const events: string[] = [];

      const serialized = Effect.gen(function* () {
        const firstEntered = yield* Deferred.make<void>();

        const first = yield* Effect.forkChild(
          withPostgresAdvisoryLock(
            pool,
            ["account-test", "shared"],
            Effect.gen(function* () {
              events.push("first-entered");
              yield* Deferred.succeed(firstEntered, undefined);
              yield* Effect.sleep("50 millis");
              events.push("first-left");
            })
          ).pipe(Effect.orDie)
        );

        yield* Deferred.await(firstEntered);

        const second = yield* Effect.forkChild(
          withPostgresAdvisoryLock(
            pool,
            ["account-test", "shared"],
            Effect.sync(() => {
              events.push("second-entered");
            })
          ).pipe(Effect.orDie)
        );

        yield* Fiber.join(first);
        yield* Fiber.join(second);
      });

      await Effect.runPromise(serialized);

      expect(events.indexOf("second-entered")).toBeGreaterThan(
        events.indexOf("first-left")
      );
      expect(events[0]).toBe("first-entered");
    });
  }
);
