import { Effect, type Layer } from "effect";
import { execute } from "./internal/executor";

interface NextEffectBaseOptions {
  readonly mapError?: (error: unknown) => unknown;
}

interface NextEffectRunnableOptions extends NextEffectBaseOptions {
  readonly layer?: undefined;
}

interface NextEffectLayerOptions<R, LE> extends NextEffectBaseOptions {
  readonly layer: Layer.Layer<R, LE, never>;
}

export type NextEffectOptions<R = never, LE = never> =
  | NextEffectRunnableOptions
  | NextEffectLayerOptions<R, LE>;

export interface NextEffectRuntime<R> {
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<A>;
  readonly page: <Props, A, E>(
    component: (props: Props) => Effect.Effect<A, E, R>
  ) => (props: Props) => Promise<A>;
}

function makeRuntime<R>(
  runEffect: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<A>
): NextEffectRuntime<R> {
  return {
    run: runEffect,
    page: (component) => (props) => runEffect(component(props)),
  };
}

function make(options?: NextEffectRunnableOptions): NextEffectRuntime<never>;
function make<R, LE>(options: NextEffectLayerOptions<R, LE>): NextEffectRuntime<R>;
function make<R, LE>(
  options: NextEffectOptions<R, LE> = {}
): NextEffectRuntime<R> | NextEffectRuntime<never> {
  if (options.layer) {
    return makeRuntime<R>((effect, runOptions) =>
      execute(Effect.provide(effect, options.layer), {
        mapError: options.mapError,
        signal: runOptions?.signal,
      })
    );
  }

  return makeRuntime<never>((effect, runOptions) =>
    execute(effect, {
      mapError: options.mapError,
      signal: runOptions?.signal,
    })
  );
}

export const NextEffect = {
  make,
};
