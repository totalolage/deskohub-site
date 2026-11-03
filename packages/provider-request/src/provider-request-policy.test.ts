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

describe("ProviderRetryPolicy operation bounds", () => {
  const retryTimeouts = policy.retryWhile(
    (failure: ProviderTimeout) => failure._tag === "ProviderTimeout"
  );
  const timeout = () => new ProviderTimeout();

  /**
   * One page request: it answers 1 ms before the attempt timeout while
   * `answers` accepts the attempt number, and never answers otherwise.
   */
  const pageAttempt = (
    attempts: Ref.Ref<readonly number[]>,
    page: number,
    answers: (attempt: number) => boolean
  ) =>
    Ref.modify(attempts, (requested) => {
      const next = [...requested, page];
      return [
        next.filter((requestedPage) => requestedPage === page).length,
        next,
      ];
    }).pipe(
      Effect.flatMap((attempt) =>
        answers(attempt)
          ? Effect.sleep(
              Duration.subtract(policy.attemptTimeout, Duration.millis(1))
            )
          : Effect.never
      ),
      policy.attempt(timeout)
    );

  /** Reads `pages` pages in order, keeping the cursor across retries. */
  const resumingLoad = (
    attempts: Ref.Ref<readonly number[]>,
    pages: number,
    answers: (page: number, attempt: number) => boolean
  ) => {
    let nextPage = 1;
    return Effect.whileLoop({
      while: () => nextPage <= pages,
      body: () =>
        pageAttempt(attempts, nextPage, (attempt) =>
          answers(nextPage, attempt)
        ),
      step: () => {
        nextPage += 1;
      },
    });
  };

  const measure = <E>(
    load: (attempts: Ref.Ref<readonly number[]>) => Effect.Effect<void, E>,
    endsAt: Duration.Duration
  ) =>
    run(
      Effect.gen(function* () {
        const attempts = yield* Ref.make<readonly number[]>([]);
        const { finishedEarly, finishedAtBound } = yield* finishesAt(
          load(attempts).pipe(Effect.exit, withJitterAt(1)),
          endsAt
        );
        return {
          finishedEarly,
          finishedAtBound,
          attempts: yield* Ref.get(attempts),
        };
      })
    );

  test("sequential calls add up one bound per call", async () => {
    const calls = 3;
    const bound = policy.worstCase.sequential(calls, "retried");
    const outcome = await measure(
      (attempts) =>
        Effect.forEach(
          [1, 2, 3],
          // A caller that carries on after each failed call.
          (call) =>
            pageAttempt(attempts, call, () => false).pipe(
              retryTimeouts,
              Effect.ignore
            ),
          { discard: true }
        ),
      bound
    );

    expect(Duration.toMillis(bound)).toBe(3 * 20_840);
    expect(Duration.toMillis(policy.worstCase.sequential(calls, "once"))).toBe(
      15_000
    );
    // Each call fails after spending its retries, and the next call starts.
    expect(outcome).toEqual({
      finishedEarly: false,
      finishedAtBound: true,
      attempts: [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3],
    });
  });

  test("a load that retries each page waits out each page's retried bound", async () => {
    const bound = policy.worstCase.paginated({ pages: 2, retry: "each-page" });
    // Page 1 answers on its last attempt; page 2 never answers.
    const outcome = await measure(
      (attempts) =>
        Effect.forEach(
          [1, 2],
          (page) =>
            pageAttempt(
              attempts,
              page,
              (attempt) => page === 1 && attempt === 4
            ).pipe(retryTimeouts),
          { discard: true }
        ),
      Duration.subtract(bound, Duration.millis(1))
    );

    expect(Duration.toMillis(bound)).toBe(2 * 20_840);
    expect(outcome).toEqual({
      finishedEarly: false,
      finishedAtBound: true,
      attempts: [1, 1, 1, 1, 2, 2, 2, 2],
    });
  });

  test("a resuming load shares its retries across pages and resends only the failed page", async () => {
    const bound = policy.worstCase.paginated({ pages: 3, retry: "resume" });
    // Pages 1 and 2 answer just in time; page 3 never answers.
    const outcome = await measure(
      (attempts) =>
        resumingLoad(attempts, 3, (page) => page < 3).pipe(retryTimeouts),
      Duration.subtract(bound, Duration.millis(2))
    );

    // Three page attempts and three retries of 5 s, plus the backoff.
    expect(Duration.toMillis(bound)).toBe(6 * 5000 + 840);
    expect(outcome).toEqual({
      finishedEarly: false,
      finishedAtBound: true,
      attempts: [1, 2, 3, 3, 3, 3],
    });
  });

  test("a resuming load spends a retry on every page it retries", async () => {
    // Every page times out once, then answers: the shared budget of three
    // retries covers three pages, so a fourth page that times out fails.
    const outcome = await measure(
      (attempts) =>
        resumingLoad(attempts, 4, (_page, attempt) => attempt > 1).pipe(
          retryTimeouts
        ),
      policy.worstCase.paginated({ pages: 4, retry: "resume" })
    );

    expect(outcome.attempts).toEqual([1, 1, 2, 2, 3, 3, 4]);
    expect(outcome.finishedAtBound).toBe(true);
  });

  test("a load that never retries waits out one attempt per page", async () => {
    const bound = policy.worstCase.paginated({ pages: 2, retry: "none" });
    const outcome = await measure(
      (attempts) => resumingLoad(attempts, 2, (page) => page === 1),
      Duration.subtract(bound, Duration.millis(1))
    );

    expect(Duration.toMillis(bound)).toBe(10_000);
    expect(outcome).toEqual({
      finishedEarly: false,
      finishedAtBound: true,
      attempts: [1, 2],
    });
  });

  test("an unknown page count has no finite bound unless the load enforces a deadline", async () => {
    for (const retry of ["each-page", "resume", "none"] as const) {
      expect(
        Duration.isFinite(
          policy.worstCase.paginated({ pages: "unknown", retry })
        )
      ).toBe(false);
      expect(
        Duration.toMillis(
          policy.worstCase.paginated({
            pages: "unknown",
            retry,
            deadline: policy.worstCase.retried,
          })
        )
      ).toBe(20_840);
    }
    // A deadline longer than the load's own bound changes nothing.
    expect(
      Duration.toMillis(
        policy.worstCase.paginated({
          pages: 2,
          retry: "none",
          deadline: "1 hour",
        })
      )
    ).toBe(10_000);

    // A load that keeps finding pages ends at its deadline.
    const outcome = await measure(
      (attempts) =>
        resumingLoad(attempts, Number.POSITIVE_INFINITY, () => true).pipe(
          retryTimeouts,
          Effect.timeoutOrElse({
            duration: policy.worstCase.retried,
            orElse: () => Effect.fail(new ProviderTimeout()),
          })
        ),
      policy.worstCase.paginated({
        pages: "unknown",
        retry: "resume",
        deadline: policy.worstCase.retried,
      })
    );
    expect(outcome.finishedEarly).toBe(false);
    expect(outcome.finishedAtBound).toBe(true);
  });

  test("counts round up, a load reads at least one page, and a count that is not finite is unbounded", () => {
    const millis = (duration: Duration.Duration) => Duration.toMillis(duration);

    expect(millis(policy.worstCase.sequential(0, "retried"))).toBe(0);
    expect(millis(policy.worstCase.sequential(-2, "once"))).toBe(0);
    expect(millis(policy.worstCase.sequential(1.5, "once"))).toBe(10_000);
    expect(
      Duration.isFinite(policy.worstCase.sequential(Number.NaN, "once"))
    ).toBe(false);
    expect(
      millis(policy.worstCase.paginated({ pages: 0, retry: "each-page" }))
    ).toBe(millis(policy.worstCase.retried));
    expect(
      millis(policy.worstCase.paginated({ pages: 1, retry: "resume" }))
    ).toBe(millis(policy.worstCase.retried));
    expect(
      Duration.isFinite(
        policy.worstCase.paginated({ pages: Number.NaN, retry: "none" })
      )
    ).toBe(false);
  });
});
