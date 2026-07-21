import { Effect, type Layer } from "effect";
import { execute } from "./internal/executor";

export type NextEffectRouteRunner<ErrorResponse extends Response = never> = <
  A extends Response,
  E,
>(
  request: Request,
  effect: Effect.Effect<A, E, never>
) => Promise<A | ErrorResponse>;

interface NextEffectBaseOptions<ErrorResponse extends Response> {
  readonly mapError?: (error: unknown) => unknown;
  readonly runRoute?: NextEffectRouteRunner<ErrorResponse>;
}

interface NextEffectRunnableOptions<ErrorResponse extends Response = never>
  extends NextEffectBaseOptions<ErrorResponse> {
  readonly layer?: undefined;
}

interface NextEffectLayerOptions<R, LE, ErrorResponse extends Response = never>
  extends NextEffectBaseOptions<ErrorResponse> {
  readonly layer: Layer.Layer<R, LE, never>;
}

export type NextEffectOptions<
  R = never,
  LE = never,
  ErrorResponse extends Response = never,
> =
  | NextEffectRunnableOptions<ErrorResponse>
  | NextEffectLayerOptions<R, LE, ErrorResponse>;

export interface NextEffectRuntime<R, ErrorResponse extends Response = never> {
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
  ) => (...args: Args) => Promise<A | ErrorResponse>;
}

function makeRuntime<R, ErrorResponse extends Response>(
  runEffect: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<A>,
  runRouteEffect: <A extends Response, E>(
    request: Request,
    effect: Effect.Effect<A, E, R>
  ) => Promise<A | ErrorResponse>
): NextEffectRuntime<R, ErrorResponse> {
  return {
    run: runEffect,
    page: (component) => (props) => runEffect(component(props)),
    route:
      (handler) =>
      (...args) =>
        runRouteEffect(args[0], handler(...args)),
  };
}

function make(): NextEffectRuntime<never>;
function make<ErrorResponse extends Response>(
  options: NextEffectRunnableOptions<ErrorResponse> & {
    readonly runRoute: NextEffectRouteRunner<ErrorResponse>;
  }
): NextEffectRuntime<never, ErrorResponse>;
function make(options: NextEffectRunnableOptions): NextEffectRuntime<never>;
function make<R, LE, ErrorResponse extends Response>(
  options: NextEffectLayerOptions<R, LE, ErrorResponse> & {
    readonly runRoute: NextEffectRouteRunner<ErrorResponse>;
  }
): NextEffectRuntime<R, ErrorResponse>;
function make<R, LE>(
  options: NextEffectLayerOptions<R, LE>
): NextEffectRuntime<R>;
function make<R, LE, ErrorResponse extends Response = never>(
  options: NextEffectOptions<R, LE, ErrorResponse> = {}
):
  | NextEffectRuntime<R, ErrorResponse>
  | NextEffectRuntime<never, ErrorResponse> {
  if (options.layer) {
    const runRoute = options.runRoute;

    return makeRuntime<R, ErrorResponse>(
      (effect, runOptions) =>
        execute(Effect.provide(effect, options.layer), {
          mapError: options.mapError,
          signal: runOptions?.signal,
        }),
      <A extends Response, E>(
        request: Request,
        effect: Effect.Effect<A, E, R>
      ) => {
        const providedEffect = Effect.provide(effect, options.layer);

        return runRoute
          ? execute<A, E | LE, ErrorResponse>(providedEffect, {
              mapError: options.mapError,
              run: (program) => runRoute(request, program),
            })
          : execute(providedEffect, {
              mapError: options.mapError,
              signal: request.signal,
            });
      }
    );
  }

  const runRoute = options.runRoute;

  return makeRuntime<never, ErrorResponse>(
    (effect, runOptions) =>
      execute(effect, {
        mapError: options.mapError,
        signal: runOptions?.signal,
      }),
    <A extends Response, E>(
      request: Request,
      effect: Effect.Effect<A, E, never>
    ) =>
      runRoute
        ? execute<A, E, ErrorResponse>(effect, {
            mapError: options.mapError,
            run: (program) => runRoute(request, program),
          })
        : execute(effect, {
            mapError: options.mapError,
            signal: request.signal,
          })
  );
}

export const NextEffect = {
  make,
};
