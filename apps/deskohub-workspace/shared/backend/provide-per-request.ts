import { type Context, Effect, Layer } from "effect";

/**
 * Provides `layer` to `self`, built for this request alone. It reuses what
 * the enclosing run or handler already built, and every other Layer it
 * builds, including those provided again inside `self`, stays out of
 * requests that overlap it.
 *
 * Use it where an HTTP API endpoint provides its request's Layers. A plain
 * `Effect.provide` there builds in the handler's memo map, where requests
 * that overlap share an instance still in use, along with whatever state it
 * keeps for its request, such as a cache or a release decision. Workspace
 * runs need no such step: each run already builds in its own fork.
 */
export const providePerRequest =
  <ROut, E2, RIn>(layer: Layer.Layer<ROut, E2, RIn>) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | E2, RIn | Exclude<R, ROut>> =>
    Effect.scopedWith((scope) =>
      Effect.contextWith((context: Context.Context<never>) =>
        Layer.buildWithMemoMap(
          layer,
          Layer.forkMemoMapUnsafe(Layer.CurrentMemoMap.getOrCreate(context)),
          scope
        )
      ).pipe(
        Effect.flatMap((services) => Effect.provideContext(self, services))
      )
    );
