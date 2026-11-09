import { Duration, Effect, Option } from "effect";

/**
 * How long a reservation page holds its streamed content for one group of
 * data the client can load itself. Warm shared snapshots answer well inside
 * it, while a cold provider call (Dotypos retries, Calendar timeouts) would
 * hold the form back for seconds.
 */
export const pagePreloadDeadline = Duration.millis(1500);

/**
 * Seeds a page with what `preload` delivers before the deadline. Anything it
 * fails, dies, or runs late on is left for the client to load, so a preload
 * never fails or stalls the page. Shared `"use cache"` loads it was awaiting
 * keep running to completion; only this page stops waiting for them.
 */
export const pagePreload =
  (subject: string) =>
  <A, E>(
    preload: Effect.Effect<ReadonlyArray<A>, E>
  ): Effect.Effect<ReadonlyArray<A>> =>
    preload.pipe(
      Effect.timeoutOption(pagePreloadDeadline),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.logWarning(
              `Preloaded ${subject} timed out; the client loads it`,
              { deadline: Duration.format(pagePreloadDeadline) }
            ).pipe(Effect.as<ReadonlyArray<A>>([])),
          onSome: (seeded) => Effect.succeed(seeded),
        })
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning(`Preloaded ${subject} failed; the client loads it`, {
          cause,
        }).pipe(Effect.as<ReadonlyArray<A>>([]))
      )
    );
