import { Layer, ManagedRuntime } from "effect";

export const processLifetimeLayer = <A, E>(
  layer: Layer.Layer<A, E, never>
): Layer.Layer<A, E> => {
  const runtime = ManagedRuntime.make(layer);

  return Layer.effectContext(runtime.contextEffect);
};
