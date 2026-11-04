import { Effect, Layer, ManagedRuntime, Scope } from "effect";

/**
 * Returns a function that provides `layer` to an Effect through a
 * `ManagedRuntime`, so the layer is built on first use and reused by every
 * later run.
 *
 * Runs provide the runtime's context rather than calling
 * `runtime.runPromise`, so `mapError` still sees layer build failures.
 *
 * The runtime is never disposed: serverless processes end without a shutdown
 * hook, so a shared layer must not rely on finalizers. A failed build stays
 * cached.
 */
export const makeSharedLayerProvider = <R, LE>(
  layer: Layer.Layer<R, LE, never>,
  memoMap?: Layer.MemoMap
) => {
  const runtime = ManagedRuntime.make(layer, { memoMap });

  return <A, E>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | LE> =>
    Effect.flatMap(runtime.contextEffect, (context) =>
      Effect.provideContext(
        // Layers a run provides itself memoize into the current memo map. A
        // per-run fork reuses the shared layers but keeps new ones per run, as
        // a per-run `Effect.provide(layer)` did, so concurrent requests never
        // share them.
        Effect.provideService(
          effect,
          Layer.CurrentMemoMap,
          Layer.forkMemoMapUnsafe(runtime.memoMap)
        ),
        context
      )
    );
};

/**
 * `layer` built at most once per process, by the first run that uses it, and
 * shared by every later run, such as a provider client and its token cache.
 * Wherever a run provides it, the run gets the process instance.
 *
 * - Share only capabilities that read nothing from a request and need no
 *   finalizer. The build's scope is never closed, since serverless processes
 *   end without a shutdown hook, and anything the build captured from the
 *   first request (headers, request context, an abort signal) would serve
 *   every later one.
 * - Only a successful build is kept. A build that fails or is interrupted
 *   fails the runs waiting for it and is dropped, so the next run builds
 *   again. A runtime's own layer (`NextEffect.make`) instead keeps a failed
 *   build.
 * - The build runs in the first run's fiber, so its logs and spans belong to
 *   that run.
 * - Each shared layer memoizes the layers it is built from by itself. A run
 *   that provides one of those layers directly builds its own, and two shared
 *   layers share only what they both are built from as a shared layer.
 */
export const shareAcrossRequests = <A, E>(
  layer: Layer.Layer<A, E, never>
): Layer.Layer<A, E> => {
  const memoMap = Layer.makeMemoMapUnsafe();
  const scope = Scope.makeUnsafe();

  return Layer.fromBuild(() => Layer.buildWithMemoMap(layer, memoMap, scope));
};
