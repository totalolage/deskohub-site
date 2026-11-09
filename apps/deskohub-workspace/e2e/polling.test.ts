import { expect, test } from "bun:test";
import { Clock, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { pollUntil } from "./polling";

const pollAttemptTimes = (options: {
  readonly initialIntervalMs?: number;
  readonly intervalMs: number;
}) =>
  Effect.gen(function* () {
    const attemptTimes: number[] = [];
    const fiber = yield* Effect.forkChild(
      pollUntil(
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => {
            attemptTimes.push(now);
            return attemptTimes.length === 7 ? attemptTimes : undefined;
          })
        ),
        { ...options, label: "test condition", timeoutMs: 60_000 }
      )
    );
    yield* TestClock.adjust("60 seconds");
    const times = yield* Fiber.join(fiber);
    return times.slice(1).map((time, index) => time - (times[index] ?? 0));
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

test("keeps fixed spacing without an initial interval", async () => {
  expect(await pollAttemptTimes({ intervalMs: 5000 })).toEqual([
    5000, 5000, 5000, 5000, 5000, 5000,
  ]);
});

test("backs off from the initial interval up to the poll interval", async () => {
  expect(
    await pollAttemptTimes({ initialIntervalMs: 500, intervalMs: 5000 })
  ).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
});
