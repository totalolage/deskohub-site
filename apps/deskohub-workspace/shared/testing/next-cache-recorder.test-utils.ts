import type { SharedSnapshotLifetime } from "@/shared/backend/shared-snapshot";

/** One `cacheLife` or `cacheTag` call a `"use cache"` function made. */
export type NextCacheCall =
  | { readonly cacheLife: SharedSnapshotLifetime }
  | { readonly cacheTag: ReadonlyArray<string> };

/**
 * A `next/cache` stand-in that records the lifetimes and tags a `"use cache"`
 * function sets, in call order. Pass `module` to `mock.module("next/cache")`
 * and clear `calls` between tests.
 */
export const recordNextCache = () => {
  const calls: NextCacheCall[] = [];
  return {
    calls,
    module: {
      cacheLife: (lifetime: SharedSnapshotLifetime) => {
        calls.push({ cacheLife: lifetime });
      },
      cacheTag: (...tags: string[]) => {
        calls.push({ cacheTag: tags });
      },
    },
    clear: () => {
      calls.length = 0;
    },
  };
};
