import { type Duration, Effect, type Predicate, Schedule } from "effect";

/** How long `dhw` waits between two reads of a server-side job. */
export const pollInterval = "2 seconds";

interface PollOptions<E2> {
  /** Bounds the whole wait, not one read. */
  readonly timeout: Duration.Input;
  readonly onTimeout: () => E2;
}

/**
 * Repeats `poll` every {@link pollInterval} until its result is settled, and
 * fails with `onTimeout` when it isn't settled within `timeout`.
 */
export function pollUntil<A, B extends A, E, R, E2>(
  poll: Effect.Effect<A, E, R>,
  options: PollOptions<E2> & { readonly settled: Predicate.Refinement<A, B> }
): Effect.Effect<B, E | E2, R>;
export function pollUntil<A, E, R, E2>(
  poll: Effect.Effect<A, E, R>,
  options: PollOptions<E2> & { readonly settled: Predicate.Predicate<A> }
): Effect.Effect<A, E | E2, R>;
export function pollUntil<A, E, R, E2>(
  poll: Effect.Effect<A, E, R>,
  {
    onTimeout,
    settled,
    timeout,
  }: PollOptions<E2> & { readonly settled: Predicate.Predicate<A> }
): Effect.Effect<A, E | E2, R> {
  return poll.pipe(
    Effect.repeat({ schedule: Schedule.spaced(pollInterval), until: settled }),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(onTimeout()),
    })
  );
}
