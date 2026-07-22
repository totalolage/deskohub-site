import { Effect, type Layer } from "effect";
import {
  type EffectRunExit,
  type ExecuteRun,
  execute,
} from "./internal/executor";

export type { EffectRunExit } from "./internal/executor";

export type NextEffectRouteRunner<ErrorResponse extends Response = never> = <
  A extends Response,
  E,
>(
  request: Request,
  effect: Effect.Effect<A, E, never>
) => Promise<A | ErrorResponse>;

interface NextEffectBaseOptions {
  readonly mapError?: (error: unknown) => unknown;
}

type NextEffectExecutorOptions<ErrorResponse extends Response> =
  | {
      readonly run?: ExecuteRun;
      readonly runExit?: never;
      readonly runRoute?: NextEffectRouteRunner<ErrorResponse>;
    }
  | {
      readonly run?: never;
      readonly runExit: EffectRunExit;
      readonly runRoute?: never;
    };

type NextEffectRunnableOptions<ErrorResponse extends Response = never> =
  NextEffectBaseOptions &
    NextEffectExecutorOptions<ErrorResponse> & {
      readonly layer?: undefined;
    };

type NextEffectLayerOptions<
  R,
  LE,
  ErrorResponse extends Response = never,
> = NextEffectBaseOptions &
  NextEffectExecutorOptions<ErrorResponse> & {
    readonly layer: Layer.Layer<R, LE, never>;
  };

export type NextEffectOptions<
  R = never,
  LE = never,
  ErrorResponse extends Response = never,
> =
  | NextEffectRunnableOptions<ErrorResponse>
  | NextEffectLayerOptions<R, LE, ErrorResponse>;

export interface NextEffectRouteOptions<
  Args extends [request: Request, ...rest: readonly unknown[]],
> {
  readonly signal?: AbortSignal | ((...args: Args) => AbortSignal | undefined);
}

export interface NextEffectRuntime<R, ErrorResponse extends Response = never> {
  /** @deprecated Prefer a lifecycle-specific adapter at the application boundary. */
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: { readonly signal?: AbortSignal }
  ) => Promise<A>;
  readonly page: <Props, A, E>(
    component: (props: Props) => Effect.Effect<A, E, R>
  ) => (props: Props) => Promise<A>;
  readonly route: {
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
    >(
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A | ErrorResponse>;
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
    >(
      options: NextEffectRouteOptions<Args>,
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A | ErrorResponse>;
  };
  readonly action: <Args extends readonly unknown[], A, E>(
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) => (...args: Args) => Promise<A>;
}

function makeRuntime<R, ErrorResponse extends Response>(options: {
  readonly runEffect: <A, E>(
    effect: Effect.Effect<A, E, R>,
    runOptions?: { readonly signal?: AbortSignal }
  ) => Promise<A>;
  readonly runLegacyRouteEffect: <A extends Response, E>(
    request: Request,
    effect: Effect.Effect<A, E, R>
  ) => Promise<A | ErrorResponse>;
}): NextEffectRuntime<R, ErrorResponse> {
  const route = (<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
  >(
    optionsOrHandler:
      | NextEffectRouteOptions<Args>
      | ((...args: Args) => Effect.Effect<A, E, R>),
    explicitHandler?: (...args: Args) => Effect.Effect<A, E, R>
  ) => {
    const hasExplicitOptions = typeof optionsOrHandler !== "function";
    const routeOptions = hasExplicitOptions ? optionsOrHandler : undefined;
    const handler = hasExplicitOptions ? explicitHandler : optionsOrHandler;

    if (!handler) {
      throw new TypeError("NextEffect.route requires a handler");
    }

    return async (...args: Args): Promise<A | ErrorResponse> => {
      const effect = Effect.suspend(() => handler(...args));
      if (!routeOptions) {
        return options.runLegacyRouteEffect(args[0], effect);
      }

      const signal =
        typeof routeOptions.signal === "function"
          ? routeOptions.signal(...args)
          : routeOptions.signal;
      return options.runEffect(effect, { signal });
    };
  }) as NextEffectRuntime<R, ErrorResponse>["route"];

  return {
    run: (effect, runOptions) =>
      options.runEffect(
        Effect.suspend(() => effect),
        runOptions
      ),
    page: (component) => async (props) =>
      options.runEffect(Effect.suspend(() => component(props))),
    route,
    action:
      (handler) =>
      async (...args) =>
        options.runEffect(Effect.suspend(() => handler(...args))),
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
function make<ErrorResponse extends Response = never>(
  options: NextEffectRunnableOptions<ErrorResponse>
): NextEffectRuntime<never, ErrorResponse>;
function make<R, LE, ErrorResponse extends Response = never>(
  options: NextEffectLayerOptions<R, LE, ErrorResponse>
): NextEffectRuntime<R, ErrorResponse>;
function make<R, LE, ErrorResponse extends Response = never>(
  options: NextEffectOptions<R, LE, ErrorResponse> = {}
):
  | NextEffectRuntime<R, ErrorResponse>
  | NextEffectRuntime<never, ErrorResponse> {
  assertExecutorOptions(options);

  if (options.layer) {
    const runEffect = <A, E>(
      effect: Effect.Effect<A, E, R>,
      runOptions?: { readonly signal?: AbortSignal }
    ) =>
      execute(
        Effect.provide(effect, options.layer),
        getExecuteOptions(options, runOptions?.signal)
      );

    return makeRuntime<R, ErrorResponse>({
      runEffect,
      runLegacyRouteEffect: <A extends Response, E>(
        request: Request,
        effect: Effect.Effect<A, E, R>
      ) => {
        const providedEffect = Effect.provide(effect, options.layer);
        const runRoute = options.runRoute;
        return runRoute
          ? execute<A, E | LE, ErrorResponse>(providedEffect, {
              mapError: options.mapError,
              run: (program) => runRoute(request, program),
            })
          : runEffect(effect, { signal: request.signal });
      },
    });
  }

  const runEffect = <A, E>(
    effect: Effect.Effect<A, E, never>,
    runOptions?: { readonly signal?: AbortSignal }
  ) => execute(effect, getExecuteOptions(options, runOptions?.signal));

  return makeRuntime<never, ErrorResponse>({
    runEffect,
    runLegacyRouteEffect: <A extends Response, E>(
      request: Request,
      effect: Effect.Effect<A, E, never>
    ) => {
      const runRoute = options.runRoute;
      return runRoute
        ? execute<A, E, ErrorResponse>(effect, {
            mapError: options.mapError,
            run: (program) => runRoute(request, program),
          })
        : runEffect(effect, { signal: request.signal });
    },
  });
}

function getExecuteOptions<ErrorResponse extends Response>(
  options: NextEffectExecutorOptions<ErrorResponse> & NextEffectBaseOptions,
  signal?: AbortSignal
) {
  return options.runExit
    ? { mapError: options.mapError, runExit: options.runExit, signal }
    : { mapError: options.mapError, run: options.run, signal };
}

function assertExecutorOptions(options: {
  readonly run?: ExecuteRun;
  readonly runExit?: EffectRunExit;
  readonly runRoute?: NextEffectRouteRunner<Response>;
}) {
  if (
    process.env.NODE_ENV !== "production" &&
    options.runExit &&
    (options.run || options.runRoute)
  ) {
    throw new TypeError(
      "NextEffect.make cannot combine runExit with run or runRoute"
    );
  }
}

export const NextEffect = {
  make,
};
