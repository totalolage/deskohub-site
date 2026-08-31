import { expect, test } from "bun:test";
import { databasePoolTimeouts } from "./database-pool-timeouts";

test("statement limits stay at 10 seconds", () => {
  expect(databasePoolTimeouts.query_timeout).toBe(10_000);
  expect(databasePoolTimeouts.statement_timeout).toBe(10_000);
});

test("connection acquisition waits longer than any allowed statement", () => {
  const { connectionTimeoutMillis, query_timeout, statement_timeout } =
    databasePoolTimeouts;

  expect(Number.isFinite(connectionTimeoutMillis)).toBe(true);
  expect(connectionTimeoutMillis).toBeGreaterThan(query_timeout);
  expect(connectionTimeoutMillis).toBeGreaterThan(statement_timeout);
});
