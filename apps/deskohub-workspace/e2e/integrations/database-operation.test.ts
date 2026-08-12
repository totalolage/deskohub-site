import { expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import {
  runDatabaseOperation,
  runRetrySafeDatabaseOperation,
} from "./database-operation";

test("does not retry a database operation with an ambiguous outcome", async () => {
  let attempts = 0;
  const operation = Effect.suspend(() => {
    attempts += 1;
    return Effect.fail(new Error("Connection terminated unexpectedly"));
  });

  await expect(
    Effect.runPromise(runDatabaseOperation("update test value", operation))
  ).rejects.toThrow("Connection terminated unexpectedly");

  expect(attempts).toBe(1);
});

test("retries a safe operation after nested transient connection failures", async () => {
  let attempts = 0;
  const operation = Effect.suspend(() => {
    attempts += 1;
    return attempts < 3
      ? Effect.fail({
          cause: new Error("Connection terminated unexpectedly"),
        })
      : Effect.succeed([{ value: 1 }]);
  });

  const result = await Effect.runPromise(
    runRetrySafeDatabaseOperation("read test value", operation)
  );

  expect(result).toEqual([{ value: 1 }]);
  expect(attempts).toBe(3);
});

test("retries a safe operation after an Effect-wrapped connection failure", async () => {
  let attempts = 0;
  const operation = Effect.suspend(() => {
    attempts += 1;
    return attempts < 3
      ? Effect.fail({
          cause: Cause.fail(new Error("Connection terminated unexpectedly")),
        })
      : Effect.succeed([{ value: 1 }]);
  });

  const result = await Effect.runPromise(
    runRetrySafeDatabaseOperation("read test value", operation)
  );

  expect(result).toEqual([{ value: 1 }]);
  expect(attempts).toBe(3);
});

test("keeps retrying a safe operation through a brief reconnect window", async () => {
  let attempts = 0;
  const operation = Effect.suspend(() => {
    attempts += 1;
    return attempts < 6
      ? Effect.fail({
          cause: Cause.fail(new Error("Connection closed unexpectedly")),
        })
      : Effect.succeed([{ value: 1 }]);
  });

  const result = await Effect.runPromise(
    runRetrySafeDatabaseOperation("read test value", operation)
  );

  expect(result).toEqual([{ value: 1 }]);
  expect(attempts).toBe(6);
});
