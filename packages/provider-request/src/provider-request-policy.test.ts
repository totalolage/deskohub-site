import { describe, expect, test } from "bun:test";
import { Data, Duration, Effect, Fiber, Random, Ref } from "effect";
import { TestClock } from "effect/testing";
import { ProviderRetryPolicy } from "./provider-request-policy";

class ProviderTimeout extends Data.TaggedError("ProviderTimeout") {}
class ProviderRefusal extends Data.TaggedError("ProviderRefusal") {}

const policy = ProviderRetryPolicy.make({
  label: "Provider",
  baseDelay: "100 millis",
  maxRetries: 3,
}).withAttemptTimeout("5 seconds");

/** `Schedule.jittered` draws one number per delay; fix it to pin the delay. */
const withJitterAt = (draw: number) =>
  Effect.provideService(Random.Random, {
    nextDoubleUnsafe: () => draw,
    nextIntUnsafe: () => 0,
  });

/** An attempt that never answers, counting how often it starts. */
const unansweredAttempt = (attempts: Ref.Ref<number>) =>
  Ref.update(attempts, (count) => count + 1).pipe(Effect.andThen(Effect.never));

/**
 * Forks `effect`, then advances the test clock to just before and exactly at
 * `bound`, reporting whether the effect finished at each point.
 */
const finishesAt = <A, E>(
  effect: Effect.Effect<A, E>,
  bound: Duration.Duration
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* TestClock.adjust(Duration.subtract(bound, Duration.millis(1)));
    const finishedEarly = fiber.pollUnsafe() !== undefined;
    yield* TestClock.adjust("1 millis");
    const finishedAtBound = fiber.pollUnsafe() !== undefined;
    return { finishedEarly, finishedAtBound, fiber };
  });

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestClock.layer())));

describe("ProviderRetryPolicy bounds", () => {
  test("derives the per-attempt and retried worst cases from one declaration", () => {
    expect(Duration.toMillis(policy.worstCase.once)).toBe(5000);
    // Four 5-second attempts plus 120 + 240 + 480 ms of maximal backoff.
    expect(Duration.toMillis(policy.worstCaseBackoff)).toBe(840);
    expect(Duration.toMillis(policy.worstCase.retried)).toBe(20_840);
  });

  test("a request whose every attempt times out ends exactly at its retried worst case under maximal jitter", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const request = unansweredAttempt(attempts).pipe(
          policy.attempt(() => new ProviderTimeout()),
          policy.retryWhile(
            (failure: ProviderTimeout) => failure._tag === "ProviderTimeout"
          ),
          withJitterAt(1)
        );
        const { finishedEarly, finishedAtBound, fiber } = yield* finishesAt(
          request,
          policy.worstCase.retried
        );
        return {
          finishedEarly,
          finishedAtBound,
          attempts: yield* Ref.get(attempts),
          exit: yield* Fiber.await(fiber),
        };
      })
    );

    expect(outcome.finishedEarly).toBe(false);
    expect(outcome.finishedAtBound).toBe(true);
    expect(outcome.attempts).toBe(4);
    expect(outcome.exit).toMatchObject({
      _tag: "Failure",
      cause: { reasons: [{ error: { _tag: "ProviderTimeout" } }] },
    });
  });

  test("the retried worst case stays conservative under minimal jitter", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const request = unansweredAttempt(attempts).pipe(
          policy.attempt(() => new ProviderTimeout()),
          policy.retryWhile(() => true),
          withJitterAt(0)
        );
        // 4 × 5 s plus 80 + 160 + 320 ms of minimal backoff.
        const { finishedEarly, finishedAtBound } = yield* finishesAt(
          request,
          Duration.millis(20_560)
        );
        return { finishedEarly, finishedAtBound };
      })
    );

    expect(outcome).toEqual({ finishedEarly: false, finishedAtBound: true });
    expect(Duration.toMillis(policy.worstCase.retried)).toBeGreaterThan(20_560);
  });

  test("a request that runs once ends at one attempt timeout", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const interrupted = yield* Ref.make(false);
        const request = unansweredAttempt(attempts).pipe(
          Effect.onInterrupt(() => Ref.set(interrupted, true)),
          policy.attempt(() => new ProviderTimeout())
        );
        const { finishedEarly, finishedAtBound } = yield* finishesAt(
          request,
          policy.worstCase.once
        );
        return {
          finishedEarly,
          finishedAtBound,
          attempts: yield* Ref.get(attempts),
          interrupted: yield* Ref.get(interrupted),
        };
      })
    );

    expect(outcome).toEqual({
      finishedEarly: false,
      finishedAtBound: true,
      attempts: 1,
      interrupted: true,
    });
  });
});

describe("ProviderRetryPolicy retries", () => {
  const failingAttempt = (
    attempts: Ref.Ref<number>,
    failure: (attempt: number) => ProviderTimeout | ProviderRefusal
  ) =>
    Ref.updateAndGet(attempts, (count) => count + 1).pipe(
      Effect.flatMap((attempt) => Effect.fail(failure(attempt)))
    );

  const countAttempts = (
    failure: (attempt: number) => ProviderTimeout | ProviderRefusal,
    retry = policy
  ) =>
    run(
      Effect.gen(function* () {
        const attempts = yield* Ref.make(0);
        const fiber = yield* Effect.forkChild(
          failingAttempt(attempts, failure).pipe(
            retry.retryWhile(
              (outcome: ProviderTimeout | ProviderRefusal) =>
                outcome._tag === "ProviderTimeout"
            ),
            withJitterAt(1)
          )
        );
        yield* TestClock.adjust(retry.worstCaseBackoff);
        yield* Fiber.await(fiber);
        return yield* Ref.get(attempts);
      })
    );

  test("retries an eligible failure up to the declared ceiling", async () => {
    expect(await countAttempts(() => new ProviderTimeout())).toBe(4);
  });

  test("stops at the first failure the operation does not retry", async () => {
    expect(
      await countAttempts((attempt) =>
        attempt === 2 ? new ProviderRefusal() : new ProviderTimeout()
      )
    ).toBe(2);
  });

  test("a declaration without retries sends one attempt and adds no backoff", async () => {
    const single = ProviderRetryPolicy.make({
      label: "Single",
      baseDelay: "1 second",
      maxRetries: 0,
    }).withAttemptTimeout("2 seconds");

    expect(Duration.toMillis(single.worstCaseBackoff)).toBe(0);
    expect(Duration.toMillis(single.worstCase.retried)).toBe(2000);
    expect(await countAttempts(() => new ProviderTimeout(), single)).toBe(1);
  });
});
