import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { tryWorkspaceE2EPromise } from "./errors";

test("aborts an in-flight promise when its fiber is interrupted", async () => {
  let signal: AbortSignal | undefined;

  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        tryWorkspaceE2EPromise("wait forever", (abortSignal) => {
          signal = abortSignal;
          return new Promise<never>(() => undefined);
        })
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
    })
  );

  expect(signal?.aborted).toBe(true);
});
