import { Deferred, Effect } from "effect";

/**
 * `Effect.cached` that Next.js can prerender: the returned effect runs `self`
 * on its first use and answers every later use, concurrent ones included, with
 * that run's exit, interruption too.
 *
 * `Effect.cached` reads the clock when a run finishes, even without a time to
 * live. Next.js rejects that `Date.now()` while prerendering a route that has
 * request-time content, so render code memoizes with this instead.
 */
export const cached = <A, E, R>(
  self: Effect.Effect<A, E, R>
): Effect.Effect<Effect.Effect<A, E, R>> =>
  Effect.sync(() => {
    let result: Deferred.Deferred<A, E> | undefined;
    return Effect.suspend(() => {
      if (result) return Deferred.await(result);
      // Claimed synchronously, so uses that start meanwhile wait for this run.
      const run = Deferred.makeUnsafe<A, E>();
      result = run;
      return Effect.andThen(Deferred.into(self, run), Deferred.await(run));
    });
  });
