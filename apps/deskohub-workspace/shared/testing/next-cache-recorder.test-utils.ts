import type { SharedSnapshotLifetime } from "@/shared/backend/shared-snapshot";

/** One `cacheLife` or `cacheTag` call a `"use cache"` function made. */
export type NextCacheCall =
  | { readonly cacheLife: SharedSnapshotLifetime }
  | { readonly cacheTag: ReadonlyArray<string> };

type NextCacheFunction = "cacheLife" | "cacheTag";

/**
 * A `next/cache` stand-in that records the lifetimes and tags a `"use cache"`
 * function sets, in call order. Pass `module` to `mock.module("next/cache")`
 * and `clear` it between tests; `failNext` makes the next call to one of the
 * functions record and then throw.
 */
export const recordNextCache = () => {
  const calls: NextCacheCall[] = [];
  let pendingFailure:
    | { readonly fn: NextCacheFunction; readonly error: Error }
    | undefined;
  const record = (fn: NextCacheFunction, call: NextCacheCall) => {
    calls.push(call);
    if (pendingFailure?.fn !== fn) return;
    const { error } = pendingFailure;
    pendingFailure = undefined;
    throw error;
  };

  return {
    calls,
    module: {
      cacheLife: (lifetime: SharedSnapshotLifetime) =>
        record("cacheLife", { cacheLife: lifetime }),
      cacheTag: (...tags: string[]) => record("cacheTag", { cacheTag: tags }),
    },
    failNext: (fn: NextCacheFunction, error: Error) => {
      pendingFailure = { fn, error };
    },
    clear: () => {
      calls.length = 0;
      pendingFailure = undefined;
    },
  };
};
