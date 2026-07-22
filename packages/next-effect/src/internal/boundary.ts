import { Effect, type Layer } from "effect";

export const provideBoundaryLayer = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  layer
    ? Effect.provide(effect, layer)
    : (effect as Effect.Effect<A, E | LE, never>);
