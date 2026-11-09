import "server-only";

import { Data, Effect } from "effect";
import { type CacheLifeProfiles, cacheLife, cacheTag } from "next/cache";
import {
  runWorkspaceEffect,
  runWorkspaceEffectOrElse,
  type WorkspaceEffectBoundary,
} from "./workspace-effect";

/** A `cacheLife` profile from `next.config.mjs`, or an explicit lifetime. */
export type SharedSnapshotLifetime =
  | keyof CacheLifeProfiles
  | {
      readonly stale?: number;
      readonly revalidate?: number;
      readonly expire?: number;
    };

/** How long one outcome of a snapshot is shared, and what expires it early. */
interface SnapshotShare {
  readonly lifetime: SharedSnapshotLifetime;
  readonly tags?: ReadonlyArray<string>;
}

/** How each outcome of a `"use cache"` load is shared. */
export interface SharedSnapshotPolicy<A, F> {
  readonly boundary?: WorkspaceEffectBoundary;
  /** A value the load produced in full. */
  readonly complete: SnapshotShare;
  /** A value `when` finds missing parts, shared instead of `complete`. */
  readonly incomplete?: SnapshotShare & {
    readonly when: (value: A) => boolean;
  };
  /**
   * The value served for a failed load, including a Workspace runtime that
   * cannot start, logged once under `failureCode`. Without it, the failure
   * rejects and is never shared.
   */
  readonly failure?: SnapshotShare & {
    /** Stable, low-cardinality log code without IDs, URLs, or payload data. */
    readonly failureCode: string;
    readonly fallback: () => F;
  };
}

/**
 * Runs a `"use cache"` function's load and shares its outcome under
 * `policy`, in the calling function's cache scope: call it from the
 * function that holds the directive. A load that rejects, whether a failure
 * without a fallback, an interruption, or Next.js control flow such as
 * `notFound`, rejects unchanged with its entry expired at once, since a
 * remote cache handler still receives an entry whose render errored.
 */
export function readSharedSnapshot<A, E, F = never>(
  operation: string,
  load: Effect.Effect<A, E, never>,
  { boundary, complete, incomplete, failure }: SharedSnapshotPolicy<A, F>
): Promise<A | F> {
  const shared = load.pipe(
    Effect.map(
      (value): SharedRead<A | F> => ({
        value,
        share: incomplete?.when(value) ? incomplete : complete,
      })
    )
  );
  const read = failure
    ? shared.pipe(
        runWorkspaceEffectOrElse(operation, {
          boundary,
          failureCode: failure.failureCode,
          orElse: (): SharedRead<A | F> => ({
            value: failure.fallback(),
            share: failure,
          }),
        })
      )
    : shared.pipe(runWorkspaceEffect(operation, { boundary }));

  // Recovery stays with the runner; this only keeps any rejection, including
  // one from applying the outcome's lifetime, out of the shared cache.
  return read
    .then(({ value, share }) => {
      setLifetime(share.lifetime);
      if (share.tags?.length) cacheTag(...share.tags);
      return value;
    })
    .catch((cause: unknown) => {
      cacheLife({ expire: 0 });
      throw cause;
    });
}

interface SharedRead<A> {
  readonly value: A;
  readonly share: SnapshotShare;
}

// `next/cache` declares one overload per profile, which no union of
// profiles matches; its implementation takes any of them.
const setLifetime = (lifetime: SharedSnapshotLifetime) =>
  (cacheLife as (lifetime: SharedSnapshotLifetime) => void)(lifetime);

/** A `"use cache"` snapshot loader rejected instead of returning its value. */
export class SharedSnapshotLoadFailure extends Data.TaggedError(
  "SharedSnapshotLoadFailure"
)<{
  readonly service: string;
  readonly operation: string;
  readonly cause: unknown;
}> {}

/**
 * Reads a shared snapshot loader. Reference the loader only inside `load`:
 * the `"use cache"` compiler assigns it after module evaluation.
 */
export const fromSharedSnapshot = <A>({
  service,
  operation,
  load,
}: {
  readonly service: string;
  readonly operation: string;
  readonly load: () => Promise<A>;
}) =>
  Effect.tryPromise({
    try: load,
    catch: (cause) =>
      new SharedSnapshotLoadFailure({ service, operation, cause }),
  });
