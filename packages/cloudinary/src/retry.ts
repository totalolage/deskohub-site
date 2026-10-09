import { Duration, Effect, Schedule } from "effect";

/**
 * Retries only transient provider failures: 5xx-style HTTP codes. 4xx failures
 * and errors without an HTTP code are definitive for the caller.
 */
export function createTransientRetryPolicy<
  E extends { readonly httpCode?: number | undefined },
>(operation: string) {
  return Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.while<E, Duration.Duration>(
      ({ input }) => input.httpCode !== undefined && input.httpCode >= 500
    ),
    Schedule.both(Schedule.recurs(2)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(
        `Cloudinary ${operation} retry attempt #${attempt + 1}`,
        {
          attemptNumber: attempt + 1,
          delayMs: Duration.toMillis(delay),
          maxRetries: 2,
        }
      )
    )
  );
}
