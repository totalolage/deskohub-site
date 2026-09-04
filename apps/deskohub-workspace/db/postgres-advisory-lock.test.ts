import { describe, expect, test } from "bun:test";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type PostgresAdvisoryLockClient,
  type PostgresAdvisoryLockPool,
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
    expect(Cause.squash(exit.cause)).toBe(insideFailure);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeInstanceOf(Error);
  });
});

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "Postgres advisory lock against real Postgres",
  () => {
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
