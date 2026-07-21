import { Effect, type Layer } from "effect";
import { execute } from "./internal/executor";

export type NextEffectRouteRunner = <A, E>(
  request: Request,
  effect: Effect.Effect<A, E, never>
) => Promise<A>;

interface NextEffectBaseOptions {
  readonly mapError?: (error: unknown) => unknown;
  readonly runRoute?: NextEffectRouteRunner;
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
  readonly route: <
    Args extends [request: Request, ...rest: Array<unknown>],
    A extends Response,
    E,
  >(
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) => (...args: Args) => Promise<A>;
}

function makeRuntime<R>(
  runEffect: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<A>,
  runRouteEffect: <A, E>(
    request: Request,
    effect: Effect.Effect<A, E, R>
  ) => Promise<A>
): NextEffectRuntime<R> {
  return {
    run: runEffect,
    page: (component) => (props) => runEffect(component(props)),
    route:
      (handler) =>
      (...args) =>
        runRouteEffect(args[0], handler(...args)),
  };
}

function make(options?: NextEffectRunnableOptions): NextEffectRuntime<never>;
function make<R, LE>(
  options: NextEffectLayerOptions<R, LE>
): NextEffectRuntime<R>;
function make<R, LE>(
  options: NextEffectOptions<R, LE> = {}
): NextEffectRuntime<R> | NextEffectRuntime<never> {
  if (options.layer) {
    const runRoute = options.runRoute;

    return makeRuntime<R>(
      (effect, runOptions) =>
        execute(Effect.provide(effect, options.layer), {
          mapError: options.mapError,
          signal: runOptions?.signal,
        }),
      (request, effect) =>
        execute(Effect.provide(effect, options.layer), {
          mapError: options.mapError,
          run: runRoute
            ? (providedEffect) => runRoute(request, providedEffect)
            : undefined,
          signal: runRoute ? undefined : request.signal,
        })
    );
  }

  const runRoute = options.runRoute;

  return makeRuntime<never>(
    (effect, runOptions) =>
      execute(effect, {
        mapError: options.mapError,
        signal: runOptions?.signal,
      }),
    (request, effect) =>
      execute(effect, {
        mapError: options.mapError,
        run: runRoute
          ? (providedEffect) => runRoute(request, providedEffect)
          : undefined,
        signal: runRoute ? undefined : request.signal,
      })
  );
}

export const NextEffect = {
  make,
};
