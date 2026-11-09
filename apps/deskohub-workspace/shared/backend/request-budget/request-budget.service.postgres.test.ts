import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { DateTime, Duration, Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
import { databasePoolTimeouts } from "@/db/database-pool-timeouts";
import {
  holdPostgresTransaction,
  waitForPostgresLockWaiter,
} from "@/shared/testing/workspace-postgres-lock-waiters.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  RequestBudget,
  type RequestBudgetPolicy,
  RequestBudgetSpend,
  RequestBudgetUnavailable,
} from "./request-budget.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const startedAt = Temporal.Instant.from("2026-10-16T09:00:00Z");
const keyPrefix = `request-budget-test-${randomUUID()}`;

const policyFor = (
  limit: number,
  window = Duration.minutes(30)
): RequestBudgetPolicy => ({
  key: `${keyPrefix}-${randomUUID()}`,
  limit,
  window,
});

const granted = RequestBudgetSpend.Granted();

const exhaustedUntil = (retryAt: Temporal.Instant) =>
  RequestBudgetSpend.Exhausted({
    retryAt: DateTime.makeUnsafe(retryAt.epochMilliseconds),
  });

describe.skipIf(!testDatabase)("RequestBudget on disposable Postgres", () => {
  if (!testDatabase) return;

  // A second pool and client stand in for another server instance.
  const otherInstancePool = makeDatabasePool({
    connectionString: process.env.WORKSPACE_TEST_DATABASE_URL ?? "",
    ...databasePoolTimeouts,
  });

  afterAll(async () => {
    await otherInstancePool.end();
    await testDatabase.pool.query(
      "delete from request_budget_spends where budget_key like $1",
      [`${keyPrefix}-%`]
    );
  });

  const budgetOn = (database: Layer.Layer<WorkspaceDatabase>) =>
    RequestBudget.Default.pipe(Layer.provide(database));

  const otherInstanceDatabase = Layer.effect(
    WorkspaceDatabase,
    makeDatabaseClient(otherInstancePool).pipe(
      Effect.map((db) => WorkspaceDatabase.make(db))
    )
  );

  /** Spends at `startedAt` plus `elapsed` on the test clock. */
  const spendAt = (
    elapsed: Temporal.DurationLike,
    policy: RequestBudgetPolicy,
    database: Layer.Layer<WorkspaceDatabase> = testDatabase.layer
  ) =>
    Effect.runPromise(
      TestClock.setTime(startedAt.add(elapsed).epochMilliseconds).pipe(
        Effect.andThen(
          Effect.flatMap(RequestBudget, (budget) => budget.spend(policy))
        ),
        Effect.provide(Layer.merge(budgetOn(database), TestClock.layer()))
      )
    );

  const storedSpends = async (policy: RequestBudgetPolicy) => {
    const { rows } = await testDatabase.pool.query<{ spent_at: string }>(
      "select spent_at from request_budget_spends where budget_key = $1 order by spent_at",
      [policy.key]
    );
    return rows.map((row) => Temporal.Instant.from(row.spent_at).toString());
  };

  test("grants up to the limit, then reports when the oldest spend leaves the window", async () => {
    const policy = policyFor(3);

    expect(await spendAt({ minutes: 0 }, policy)).toEqual(granted);
    expect(await spendAt({ minutes: 1 }, policy)).toEqual(granted);
    expect(await spendAt({ minutes: 2 }, policy)).toEqual(granted);
    expect(await spendAt({ minutes: 3 }, policy)).toEqual(
      exhaustedUntil(startedAt.add({ minutes: 30 }))
    );
    expect(await storedSpends(policy)).toHaveLength(3);
  });

  test("grants again once the oldest spend leaves the window", async () => {
    const policy = policyFor(2);
    await spendAt({ minutes: 0 }, policy);
    await spendAt({ minutes: 5 }, policy);

    expect(
      await spendAt({ minutes: 29, seconds: 59, milliseconds: 999 }, policy)
    ).toEqual(exhaustedUntil(startedAt.add({ minutes: 30 })));
    expect(await spendAt({ minutes: 30 }, policy)).toEqual(granted);
    expect(await spendAt({ minutes: 30 }, policy)).toEqual(
      exhaustedUntil(startedAt.add({ minutes: 35 }))
    );
  });

  test("keeps budgets under different keys independent", async () => {
    const first = policyFor(1);
    const second = policyFor(1);

    expect(await spendAt({ minutes: 0 }, first)).toEqual(granted);
    expect(await spendAt({ minutes: 0 }, second)).toEqual(granted);
    expect(await spendAt({ minutes: 1 }, first)).toEqual(
      exhaustedUntil(startedAt.add({ minutes: 30 }))
    );
  });

  test("prunes spends that left the window", async () => {
    const policy = policyFor(2);
    await spendAt({ minutes: 0 }, policy);
    await spendAt({ minutes: 1 }, policy);

    expect(await spendAt({ minutes: 31 }, policy)).toEqual(granted);
    expect(await storedSpends(policy)).toEqual([
      startedAt.add({ minutes: 31 }).toString(),
    ]);
  });

  test("grants the last unit to exactly one of two instances racing for it", async () => {
    const policy = policyFor(2);
    await spendAt({ minutes: 0 }, policy);

    const lockKey = ["request-budget", policy.key];
    const holder = await holdPostgresTransaction(
      testDatabase.pool,
      "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      lockKey
    );
    const racing = Promise.all([
      spendAt({ minutes: 1 }, policy),
      spendAt({ minutes: 1 }, policy, otherInstanceDatabase),
    ]);
    await waitForPostgresLockWaiter(testDatabase.pool, {
      condition: `
        locktype = 'advisory'
        and classid::bigint = (hashtext($1)::bigint & 4294967295)
        and objid::bigint = (hashtext($2)::bigint & 4294967295)
        and objsubid = 2
        and (
          select count(*) from pg_locks waiter
          where not waiter.granted
            and waiter.locktype = 'advisory'
            and waiter.classid = pg_locks.classid
            and waiter.objid = pg_locks.objid
            and waiter.objsubid = 2
        ) = 2
      `,
      values: lockKey,
      description: "both spends to wait on the budget lock",
    });
    await holder.commit();

    const outcomes = await racing;
    expect(outcomes.map((outcome) => outcome._tag).sort()).toEqual([
      "Exhausted",
      "Granted",
    ]);
    expect(await storedSpends(policy)).toHaveLength(2);
  });
});

describe("RequestBudget without a reachable database", () => {
  test("fails with RequestBudgetUnavailable", async () => {
    const unreachablePool = makeDatabasePool({
      connectionString: "postgres://workspace:workspace@127.0.0.1:1/workspace",
      connectionTimeoutMillis: 1_000,
    });
    const unreachableDatabase = Layer.effect(
      WorkspaceDatabase,
      makeDatabaseClient(unreachablePool).pipe(
        Effect.map((db) => WorkspaceDatabase.make(db))
      )
    );

    const exit = await Effect.runPromiseExit(
      Effect.flatMap(RequestBudget, (budget) =>
        budget.spend(policyFor(1))
      ).pipe(
        Effect.flip,
        Effect.provide(
          RequestBudget.Default.pipe(Layer.provide(unreachableDatabase))
        )
      )
    );
    await unreachablePool.end();

    expect(exit).toEqual(Exit.succeed(expect.any(RequestBudgetUnavailable)));
  });
});
