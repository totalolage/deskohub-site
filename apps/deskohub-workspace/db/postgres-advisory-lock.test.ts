import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type PostgresAdvisoryLockClient,
  type PostgresAdvisoryLockPool,
  withPostgresAdvisoryLock,
} from "./postgres-advisory-lock";

const key: PostgresAdvisoryLockKey = ["test-namespace", "resource-1"];

const makeFakePool = (options?: { readonly failAcquire?: boolean }) => {
  const queries: string[] = [];
  const released: (Error | boolean | undefined)[] = [];
  let connected = 0;

  const client: PostgresAdvisoryLockClient = {
    query: (text: string) => {
      queries.push(text);
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

describe("Postgres advisory lock helper", () => {
  test("locks one dedicated client, runs the effect, then unlocks and releases", async () => {
    const fake = makeFakePool();

    const result = await Effect.runPromise(
      withPostgresAdvisoryLock(fake.pool, key, Effect.succeed("inside"))
    );

    expect(result).toBe("inside");
    expect(fake.queries).toEqual([
      "select pg_advisory_lock(hashtext($1), hashtext($2))",
      "select pg_advisory_unlock(hashtext($1), hashtext($2))",
    ]);
    expect(fake.released).toHaveLength(1);
    expect(fake.released[0]).toBeUndefined();
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
    expect(fake.queries).toHaveLength(2);
    expect(fake.released).toHaveLength(1);
  });

  test("releases the client when the guarded effect is interrupted", async () => {
    const fake = makeFakePool();
    const interruption = await Effect.runPromiseExit(
      withPostgresAdvisoryLock(fake.pool, key, Effect.interrupt)
    );

    expect(interruption._tag).toBe("Failure");
    expect(fake.queries).toHaveLength(2);
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
