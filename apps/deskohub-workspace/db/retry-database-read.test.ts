import { expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import { retryDatabaseRead } from "./retry-database-read";

test("retries a failed database read once", async () => {
  let attempts = 0;
  const result = await Effect.suspend(() => {
    attempts += 1;
    return attempts === 1
      ? Effect.fail(
          new EffectDrizzleQueryError({
            query: "select 1",
            params: [],
            cause: Cause.fail(
              new SqlError.SqlError({
                reason: new SqlError.ConnectionError({
                  cause: new Error("timeout exceeded when trying to connect"),
                  message: "timeout exceeded when trying to connect",
                  operation: "connect",
                }),
              })
            ),
          })
        )
      : Effect.succeed("loaded");
  }).pipe(retryDatabaseRead, Effect.runPromise);

  expect(result).toBe("loaded");
  expect(attempts).toBe(2);
});

test("retries uncoded connection acquisition failures", async () => {
  let attempts = 0;
  const result = await Effect.suspend(() => {
    attempts += 1;
    return attempts === 1
      ? Effect.fail(
          new EffectDrizzleQueryError({
            query: "select 1",
            params: [],
            cause: Cause.fail(
              new SqlError.SqlError({
                reason: new SqlError.UnknownError({
                  cause: new Error("timeout exceeded when trying to connect"),
                  message: "Failed to acquire connection",
                  operation: "acquireConnection",
                }),
              })
            ),
          })
        )
      : Effect.succeed("loaded");
  }).pipe(retryDatabaseRead, Effect.runPromise);

  expect(result).toBe("loaded");
  expect(attempts).toBe(2);
});

test("does not retry coded unknown connection acquisition failures", async () => {
  let attempts = 0;
  const failure = new EffectDrizzleQueryError({
    query: "select 1",
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.UnknownError({
          cause: Object.assign(new Error("database does not exist"), {
            code: "3D000",
          }),
          message: "Failed to acquire connection",
          operation: "acquireConnection",
        }),
      })
    ),
  });

  const result = await Effect.suspend(() => {
    attempts += 1;
    return Effect.fail(failure);
  }).pipe(retryDatabaseRead, Effect.flip, Effect.runPromise);

  expect(result).toBe(failure);
  expect(attempts).toBe(1);
});

test("does not retry a permanent database read failure", async () => {
  let attempts = 0;
  const failure = new EffectDrizzleQueryError({
    query: "select invalid",
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.SqlSyntaxError({
          cause: new Error("syntax error"),
          message: "syntax error",
          operation: "execute",
        }),
      })
    ),
  });

  const result = await Effect.suspend(() => {
    attempts += 1;
    return Effect.fail(failure);
  }).pipe(retryDatabaseRead, Effect.flip, Effect.runPromise);

  expect(result).toBe(failure);
  expect(attempts).toBe(1);
});
