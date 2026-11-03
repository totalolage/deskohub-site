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
  /**
   * The longest one request can take when every attempt times out. A
   * request that runs once waits out one attempt. A retried request waits out
   * the first attempt and every retry, plus the backoff between them.
   */
  readonly worstCase: {
    readonly once: Duration.Duration;
    readonly retried: Duration.Duration;
  };
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
          worstCase: {
            once: attemptTimeout,
            retried: Duration.sum(
              Duration.times(attemptTimeout, declaration.maxRetries + 1),
              worstCaseBackoff
            ),
          },
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
