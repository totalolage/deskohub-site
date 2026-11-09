import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { pagePreload, pagePreloadDeadline } from "./page-preload";

const run = <A>(effect: Effect.Effect<A>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(Layer.fresh(TestClock.layer())))
  );

describe("pagePreload", () => {
  test("leaves a failed preload to the client", async () => {
    expect(
      await run(Effect.fail(new Error("provider")).pipe(pagePreload("numbers")))
    ).toEqual([]);
  });

  test("leaves a preload that dies to the client", async () => {
    expect(
      await run(Effect.die(new Error("defect")).pipe(pagePreload("numbers")))
    ).toEqual([]);
  });

  test("stops waiting at the deadline and leaves the preload to the client", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        let interrupted = false;
        const preload = yield* Effect.never.pipe(
          Effect.as([1]),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            })
          ),
          pagePreload("numbers"),
          Effect.forkChild
        );
        yield* TestClock.adjust(pagePreloadDeadline);
        return { seeded: yield* Fiber.join(preload), interrupted };
      })
    );

    expect(outcome).toEqual({ seeded: [], interrupted: true });
  });

  test("waits for a preload that finishes just inside the deadline", async () => {
    const seeded = await run(
      Effect.gen(function* () {
        const preload = yield* Effect.sleep("1499 millis").pipe(
          Effect.as([1]),
          pagePreload("numbers"),
          Effect.forkChild
        );
        yield* TestClock.adjust(pagePreloadDeadline);
        return yield* Fiber.join(preload);
      })
    );

    expect(seeded).toEqual([1]);
  });
});
