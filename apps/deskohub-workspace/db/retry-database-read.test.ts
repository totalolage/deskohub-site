import { expect, test } from "bun:test";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect } from "effect";
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
            cause: new Error("timeout exceeded when trying to connect"),
          })
        )
      : Effect.succeed("loaded");
  }).pipe(retryDatabaseRead, Effect.runPromise);

  expect(result).toBe("loaded");
  expect(attempts).toBe(2);
});
