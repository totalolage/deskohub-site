import "server-only";

import { ExternalAPIError } from "@deskohub/dotypos";
import { Effect, Exit } from "effect";
import { cacheLife } from "next/cache";

/**
 * Applies a `"use cache"` snapshot's lifetime and tags once it loads, and
 * marks any failed load uncacheable so the failure is never shared.
 */
export function cachedOnSuccess(applyLifetime: () => void) {
  return <A, E, R>(load: Effect.Effect<A, E, R>) =>
    load.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() =>
          Exit.isSuccess(exit) ? applyLifetime() : cacheLife({ expire: 0 })
        )
      )
    );
}

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
      new ExternalAPIError({
        service,
        operation,
        message: "Shared snapshot could not be loaded",
        cause,
      }),
  });
