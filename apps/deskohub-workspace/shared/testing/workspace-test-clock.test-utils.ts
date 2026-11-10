import { Clock, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

/** Runs an Effect with the clock fixed at an instant. */
export const atInstant =
  (instant: Temporal.Instant) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    TestClock.setTime(instant.epochMilliseconds).pipe(
      Effect.andThen(effect),
      Effect.provide(TestClock.layer())
    );

/**
 * Runs `effect` on a TestClock that advances in steps far shorter than any
 * request timeout until the effect finishes, so sleeps and retry backoff
 * elapse instantly. Only for stubs that answer without real-time delays: a
 * stub that waits on a real timer would hit its request timeout.
 */
export const withInstantSleeps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("10 millis");
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

/**
 * Runs `effect` counting its reads of the wall-clock time, which Next.js
 * rejects as `Date.now()` while prerendering a route with request-time
 * content. Monotonic time and sleeps pass through uncounted.
 */
export const countWallClockReads = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const clock = yield* Clock.clockWith(Effect.succeed);
    let wallClockReads = 0;
    const currentTimeMillisUnsafe = () => {
      wallClockReads += 1;
      return clock.currentTimeMillisUnsafe();
    };
    const value = yield* effect.pipe(
      Effect.provideService(Clock.Clock, {
        currentTimeMillisUnsafe,
        currentTimeMillis: Effect.sync(currentTimeMillisUnsafe),
        currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
        currentTimeNanos: clock.currentTimeNanos,
        sleep: (duration) => clock.sleep(duration),
      })
    );
    return { value, wallClockReads };
  });
