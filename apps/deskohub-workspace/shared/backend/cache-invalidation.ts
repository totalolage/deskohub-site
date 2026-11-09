import "server-only";

import { Data, Effect } from "effect";
import { revalidateTag } from "next/cache";

class CacheInvalidationError extends Data.TaggedError(
  "CacheInvalidationError"
)<{
  readonly tag: string;
  readonly cause: unknown;
}> {}

/**
 * Marks tagged cache entries stale now so the next read refreshes them.
 *
 * Uses a one-second expiry rather than `expire: 0`, which would also make a
 * calling Server Action re-render the current page. Next rejects calls outside
 * a request or inside a cache scope; those are logged and ignored so cache
 * upkeep never fails the write that triggered it.
 */
export const expireCacheTag = Effect.fn("expireCacheTag")((tag: string) =>
  Effect.try({
    try: () => revalidateTag(tag, { expire: 1 }),
    catch: (cause) => new CacheInvalidationError({ tag, cause }),
  }).pipe(
    Effect.tapError((cause) =>
      Effect.logWarning("Cache tag invalidation failed", { tag, cause })
    ),
    Effect.ignore
  )
);
