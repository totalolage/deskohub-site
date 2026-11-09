import { Duration, Effect, Schedule } from "effect";

/**
 * How a provider package retries its requests: an exponential, jittered
 * backoff from `baseDelay`, at most `maxRetries` times. Which failures are
 * retried stays with each operation, because only the provider knows which
 * requests are safe to repeat.
 */
export interface ProviderRetryDeclaration {
  /** Names the provider (and operation, where useful) in retry logs. */
  readonly label: string;
  readonly baseDelay: Duration.Input;
  readonly maxRetries: number;
}

/** A provider's retry backoff, without a per-attempt timeout. */
export interface ProviderRetryPolicy {
  readonly maxRetries: number;
  /**
   * Retries `attempt` while `isRetryable` accepts its failure, up to
   * `maxRetries` times, and logs each retry.
   */
  readonly retryWhile: <Failure>(
    isRetryable: (failure: Failure) => boolean
  ) => <A, E extends Failure, R>(
    attempt: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;
  /** The longest total backoff between attempts, with jitter at its maximum. */
  readonly worstCaseBackoff: Duration.Duration;
  /** Adds the per-attempt timeout of a deployment. */
  readonly withAttemptTimeout: (
    attemptTimeout: Duration.Input
  ) => ProviderRequestPolicy;
}

/** A provider's retry backoff and per-attempt timeout, with their bounds. */
export interface ProviderRequestPolicy
  extends Omit<ProviderRetryPolicy, "withAttemptTimeout"> {
  readonly attemptTimeout: Duration.Duration;
  /**
   * Bounds one attempt by `attemptTimeout`. A timed-out attempt is
   * interrupted, which aborts a request that honors the abort signal, and
   * fails with the provider's typed `onTimeout` failure.
   */
  readonly attempt: <TimeoutFailure>(
    onTimeout: () => TimeoutFailure
  ) => <A, E, R>(
    attempt: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | TimeoutFailure, R>;
  /** The longest an operation built from this provider's requests can take. */
  readonly worstCase: ProviderOperationWorstCase;
}

/**
 * How many pages a paginated load reads. `"unknown"` when the provider decides
 * how many pages it returns.
 */
export type ProviderPageCount = number | "unknown";

/**
 * How a paginated load retries:
 *
 * - `each-page`: every page request is retried on its own.
 * - `resume`: the load shares one retry budget across its pages, and each
 *   retry resends the page that failed; pages already read are kept.
 * - `none`: every page request runs once and the load is not retried.
 */
export type ProviderPageRetry = "each-page" | "resume" | "none";

/**
 * Worst cases assume every attempt waits out its timeout and every backoff
 * draws the maximum jitter. Counts that are not whole numbers round up, and a
 * count that is not finite has no finite bound (`Duration.infinity`).
 */
export interface ProviderOperationWorstCase {
  /** One request that runs once: one attempt. */
  readonly once: Duration.Duration;
  /**
   * One retried request: the first attempt and every retry, plus the backoff
   * between them.
   */
  readonly retried: Duration.Duration;
  /** `calls` requests one after another, each run once or retried. */
  readonly sequential: (
    calls: number,
    each: "once" | "retried"
  ) => Duration.Duration;
  /**
   * A paginated load of `pages` pages. A load always reads its first page. An
   * `"unknown"` page count has no finite bound, unless the load enforces its
   * own `deadline` over all its pages, which then bounds it.
   */
  readonly paginated: (load: {
    readonly pages: ProviderPageCount;
    readonly retry: ProviderPageRetry;
    readonly deadline?: Duration.Input;
  }) => Duration.Duration;
}

/**
 * `Schedule.jittered` scales each delay by a random factor between 0.8 and
 * 1.2 (Effect's `Schedule.ts`). Worst cases assume the maximum.
 */
const maxJitterFactor = 1.2;
const backoffFactor = 2;

export const ProviderRetryPolicy = {
  /** Declares a provider's retry backoff once, for its schedule and bounds. */
  make: (declaration: ProviderRetryDeclaration): ProviderRetryPolicy => {
    const retryWhile =
      <Failure>(isRetryable: (failure: Failure) => boolean) =>
      <A, E extends Failure, R>(attempt: Effect.Effect<A, E, R>) =>
        Effect.retry(attempt, {
          schedule: retrySchedule(declaration, isRetryable),
        });
    const worstCaseBackoff = getWorstCaseBackoff(declaration);

    return {
      maxRetries: declaration.maxRetries,
      retryWhile,
      worstCaseBackoff,
      withAttemptTimeout: (input) => {
        const attemptTimeout = Duration.fromInputUnsafe(input);
        return {
          maxRetries: declaration.maxRetries,
          retryWhile,
          worstCaseBackoff,
          attemptTimeout,
          attempt:
            <TimeoutFailure>(onTimeout: () => TimeoutFailure) =>
            <A, E, R>(attempt: Effect.Effect<A, E, R>) =>
              attempt.pipe(
                Effect.timeoutOrElse({
                  duration: attemptTimeout,
                  orElse: () => Effect.fail(onTimeout()),
                })
              ),
          worstCase: getOperationWorstCase({
            attemptTimeout,
            maxRetries: declaration.maxRetries,
            worstCaseBackoff,
          }),
        };
      },
    };
  },
};

const retrySchedule = <Failure>(
  { label, baseDelay, maxRetries }: ProviderRetryDeclaration,
  isRetryable: (failure: Failure) => boolean
) =>
  Schedule.exponential(baseDelay, backoffFactor).pipe(
    Schedule.jittered,
    Schedule.while<Failure, Duration.Duration>(({ input }) =>
      isRetryable(input)
    ),
    Schedule.both(Schedule.recurs(maxRetries)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(`${label} retry attempt #${attempt + 1}`, {
        attemptNumber: attempt + 1,
        delayMs: Duration.toMillis(delay),
        maxRetries,
      })
    )
  );

const getWorstCaseBackoff = ({
  baseDelay,
  maxRetries,
}: ProviderRetryDeclaration) => {
  const baseMilliseconds = Duration.toMillis(
    Duration.fromInputUnsafe(baseDelay)
  );
  let backoffMilliseconds = 0;
  for (let retry = 0; retry < maxRetries; retry += 1) {
    backoffMilliseconds +=
      baseMilliseconds * backoffFactor ** retry * maxJitterFactor;
  }
  return Duration.millis(backoffMilliseconds);
};

const getOperationWorstCase = ({
  attemptTimeout,
  maxRetries,
  worstCaseBackoff,
}: {
  readonly attemptTimeout: Duration.Duration;
  readonly maxRetries: number;
  readonly worstCaseBackoff: Duration.Duration;
}): ProviderOperationWorstCase => {
  const once = attemptTimeout;
  const retried = Duration.sum(
    Duration.times(attemptTimeout, maxRetries + 1),
    worstCaseBackoff
  );
  const request = { once, retried };

  return {
    once,
    retried,
    sequential: (calls, each) => repeated(request[each], Math.max(0, calls)),
    paginated: ({ pages, retry, deadline }) => {
      const pageCount = pages === "unknown" ? Infinity : Math.max(1, pages);
      const load = {
        "each-page": () => repeated(retried, pageCount),
        // Each page waits out one attempt, and the shared retries each wait
        // out one more, plus the backoff between them.
        resume: () =>
          Duration.sum(
            repeated(attemptTimeout, pageCount + maxRetries),
            worstCaseBackoff
          ),
        none: () => repeated(once, pageCount),
      }[retry]();
      return deadline === undefined
        ? load
        : Duration.min(load, Duration.fromInputUnsafe(deadline));
    },
  };
};

/** `count` operations of `bound` one after another; rounds a partial count up. */
const repeated = (bound: Duration.Duration, count: number) =>
  Number.isFinite(count)
    ? Duration.times(bound, Math.ceil(count))
    : Duration.infinity;
