import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Pool } from "pg";
import { queryPostgres, queryPostgresRetrySafe } from "./postgres";

test("does not retry a query with an ambiguous outcome", async () => {
  let attempts = 0;
  const pool = {
    query: async () => {
      attempts += 1;
      throw new Error("Connection terminated unexpectedly");
    },
  } as unknown as Pool;

  await expect(
    Effect.runPromise(
      queryPostgres<{ value: number }>(
        pool,
        "update test value",
        "update test_values set value = 1"
      )
    )
  ).rejects.toThrow("Connection terminated unexpectedly");

  expect(attempts).toBe(1);
});

test("retries an explicitly retry-safe query after consecutive dropped connections", async () => {
  let attempts = 0;
  const pool = {
    query: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("Connection terminated unexpectedly");
      }
      return { rows: [{ value: 1 }] };
    },
  } as unknown as Pool;

  const result = await Effect.runPromise(
    queryPostgresRetrySafe<{ value: number }>(
      pool,
      "read test value",
      "select 1 as value"
    )
  );

  expect(result.rows).toEqual([{ value: 1 }]);
  expect(attempts).toBe(3);
});
