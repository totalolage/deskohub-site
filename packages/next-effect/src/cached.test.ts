import { describe, expect, test } from "bun:test";
import { Clock, Deferred, Effect, Exit, Fiber } from "effect";
import { cached } from "./cached";

const countedRun = <A, E>(answer: Effect.Effect<A, E>) => {
  let runs = 0;
  const self = Effect.suspend(() => {
    runs += 1;
    return answer;
  });
  return { self, runs: () => runs };
};

describe("cached", () => {
  test("runs once and answers every later use with that run's value", async () => {
    const { self, runs } = countedRun(Effect.succeed("decided"));

    const values = await Effect.runPromise(
      Effect.flatMap(cached(self), (decision) =>
        Effect.all([decision, decision, decision])
      )
    );

    expect(values).toEqual(["decided", "decided", "decided"]);
    expect(runs()).toBe(1);
  });

  test("makes uses that start during the run wait for it", async () => {
    const release = Deferred.makeUnsafe<void>();
    const { self, runs } = countedRun(
      Deferred.await(release).pipe(Effect.as("decided"))
    );

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const decision = yield* cached(self);
        const uses = yield* Effect.forkChild(
          Effect.all([decision, decision, decision], {
            concurrency: "unbounded",
          })
        );
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        return yield* Fiber.join(uses);
      })
    );

    expect(values).toEqual(["decided", "decided", "decided"]);
    expect(runs()).toBe(1);
  });

  test("answers every later use with a failed run's failure, without rerunning", async () => {
    const { self, runs } = countedRun(Effect.fail("unavailable"));

    const exits = await Effect.runPromise(
      Effect.flatMap(cached(self), (decision) =>
        Effect.all([Effect.exit(decision), Effect.exit(decision)])
      )
    );

    expect(exits).toEqual([Exit.fail("unavailable"), Exit.fail("unavailable")]);
    expect(runs()).toBe(1);
  });

  test("never reads the wall clock, which Next.js rejects while prerendering", async () => {
    let wallClockReads = 0;
    const clock = Effect.runSync(Clock.clockWith(Effect.succeed));
    const countingClock: Clock.Clock = {
      currentTimeMillisUnsafe: () => {
        wallClockReads += 1;
        return clock.currentTimeMillisUnsafe();
      },
      currentTimeMillis: Effect.sync(() => {
        wallClockReads += 1;
        return clock.currentTimeMillisUnsafe();
      }),
      currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
      currentTimeNanos: clock.currentTimeNanos,
      sleep: (duration) => clock.sleep(duration),
    };

    await Effect.runPromise(
      Effect.flatMap(cached(Effect.succeed("decided")), (decision) =>
        Effect.all([decision, decision])
      ).pipe(Effect.provideService(Clock.Clock, countingClock))
    );

    expect(wallClockReads).toBe(0);
  });
});
