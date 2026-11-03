import { Deferred, Effect } from "effect";
import { cache } from "react";

/**
 * An Effect whose first run in a server render is shared by every later run
 * in that render, across Workspace runs and layer builds, such as a release
 * decision a page and its loaders must agree on. Runs that start while the
 * first is still evaluating wait for it, and a failure is shared like a
 * success.
 *
 * React `cache` scopes the sharing to one render, so nothing reaches another
 * request. It doesn't memoize outside a render, such as in a Server Action or
 * route handler, where every run evaluates; memoize per layer build too where
 * one run must see one result.
 *
 * The evaluation runs detached, with the first run's services and log
 * annotations, so interrupting a consumer only stops it waiting; keep the
 * evaluation bounded.
 */
export const shareWithinRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const requestSlot = cache((): { result?: Deferred.Deferred<A, E> } => ({}));
  return Effect.suspend(() => {
    const slot = requestSlot();
    if (slot.result) return Deferred.await(slot.result);
    // Claimed synchronously, so runs that start meanwhile wait for this one.
    const result = Deferred.makeUnsafe<A, E>();
    slot.result = result;
    return Effect.forkDetach(Deferred.into(effect, result)).pipe(
      Effect.andThen(Deferred.await(result))
    );
  });
};
