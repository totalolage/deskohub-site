import { Effect, type Layer } from "effect";
import {
  EffectBoundary,
  type EffectBoundaryExecutor,
  type EffectBoundaryOptions,
  type EffectHostBoundary,
} from "./effect-boundary";
import { provideBoundaryLayer } from "./internal/boundary";
import { execute } from "./internal/executor";

export type NextEffectRequestCancellation =
  | "interrupt-on-disconnect"
  | "continue-after-disconnect";

export type NextEffectRouteFailureMapping<F, RouteFailure> = [F] extends [never]
  ? { readonly mapFailure?: never }
  : [F] extends [RouteFailure]
    ? { readonly mapFailure?: (failure: F) => RouteFailure }
    : { readonly mapFailure: (failure: F) => RouteFailure };

type NextEffectBoundaryRouteBaseOptions<E, RouteFailure> =
  EffectBoundaryOptions & {
    readonly cancellation: NextEffectRequestCancellation;
  } & NextEffectRouteFailureMapping<E, RouteFailure>;

type NextEffectBoundaryRouteLayerOptions<R, LE, E, RouteFailure> =
  NextEffectBoundaryRouteBaseOptions<E | LE, RouteFailure> & {
    readonly layer: Layer.Layer<R, LE, never>;
  };

export interface NextEffectBoundaryRoutePolicy<
  RouteFailure,
  RouteErrorResponse extends Response,
> {
  readonly isFailure: (failure: unknown) => failure is RouteFailure;
  readonly recoverFailure: (
    failure: RouteFailure
  ) => Effect.Effect<RouteErrorResponse, never, never>;
  readonly withRequest: <A, E>(
    request: Request,
    effect: Effect.Effect<A, E, never>
  ) => Effect.Effect<A, E, never>;
}

export interface NextEffectBoundaryOptions<
  RouteFailure,
  RouteErrorResponse extends Response,
> {
  readonly executor: EffectBoundaryExecutor;
  readonly route: NextEffectBoundaryRoutePolicy<
    RouteFailure,
    RouteErrorResponse
  >;
}

export interface NextEffectBoundary<
  RouteFailure,
  RouteErrorResponse extends Response,
> extends EffectHostBoundary {
  readonly page: {
    <Props, A>(
      options: EffectBoundaryOptions,
      render: (props: Props) => Effect.Effect<A, never, never>
    ): (props: Props) => Promise<A>;
    <Props, A, R>(
      options: EffectBoundaryOptions & {
        readonly layer: Layer.Layer<R, never, never>;
      },
      render: (props: Props) => Effect.Effect<A, never, R>
    ): (props: Props) => Promise<A>;
  };
  readonly route: {
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
    >(
      options: EffectBoundaryOptions & {
        readonly cancellation: NextEffectRequestCancellation;
        readonly mapFailure?: never;
      },
      handler: (...args: Args) => Effect.Effect<A, never, never>
    ): (...args: Args) => Promise<A | RouteErrorResponse>;
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
    >(
      options: NextEffectBoundaryRouteBaseOptions<E, RouteFailure>,
      handler: (...args: Args) => Effect.Effect<A, E, never>
    ): (...args: Args) => Promise<A | RouteErrorResponse>;
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
      R,
      LE,
    >(
      options: NextEffectBoundaryRouteLayerOptions<R, LE, E, RouteFailure>,
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A | RouteErrorResponse>;
  };
}

export function makeNextEffectBoundary<
  RouteFailure,
  RouteErrorResponse extends Response,
>(
  options: NextEffectBoundaryOptions<RouteFailure, RouteErrorResponse>
): NextEffectBoundary<RouteFailure, RouteErrorResponse> {
  const host = EffectBoundary.makeHost(options.executor);
  const run = <A, E>(
    effect: Effect.Effect<A, E, never>,
    signal?: AbortSignal
  ) => execute(effect, { runExit: options.executor.runExit, signal });

  function page<Props, A>(
    declaration: EffectBoundaryOptions,
    render: (props: Props) => Effect.Effect<A, never, never>
  ): (props: Props) => Promise<A>;
  function page<Props, A, R>(
    declaration: EffectBoundaryOptions & {
      readonly layer: Layer.Layer<R, never, never>;
    },
    render: (props: Props) => Effect.Effect<A, never, R>
  ): (props: Props) => Promise<A>;
  function page<Props, A, R>(
    declaration: EffectBoundaryOptions & {
      readonly layer?: Layer.Layer<R, never, never>;
    },
    render: (props: Props) => Effect.Effect<A, never, R>
  ) {
    return (props: Props) =>
      run(
        provideBoundaryLayer(
          Effect.suspend(() => render(props)),
          declaration.layer
        ).pipe(
          Effect.annotateLogs({
            boundary: "page",
            operation: declaration.operation,
          })
        )
      );
  }

  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
  >(
    declaration: EffectBoundaryOptions & {
      readonly cancellation: NextEffectRequestCancellation;
      readonly mapFailure?: never;
    },
    handler: (...args: Args) => Effect.Effect<A, never, never>
  ): (...args: Args) => Promise<A | RouteErrorResponse>;
  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
  >(
    declaration: NextEffectBoundaryRouteBaseOptions<E, RouteFailure>,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ): (...args: Args) => Promise<A | RouteErrorResponse>;
  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
    R,
    LE,
  >(
    declaration: NextEffectBoundaryRouteLayerOptions<R, LE, E, RouteFailure>,
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ): (...args: Args) => Promise<A | RouteErrorResponse>;
  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
    R,
    LE,
  >(
    declaration: EffectBoundaryOptions & {
      readonly cancellation: NextEffectRequestCancellation;
      readonly mapFailure?: (failure: E | LE) => RouteFailure;
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) {
    return (...args: Args) => {
      const request = args[0];
      const provided = provideBoundaryLayer(
        Effect.suspend(() => handler(...args)),
        declaration.layer
      );
      const mapFailure = declaration.mapFailure;
      const mapped = mapFailure
        ? Effect.mapError(provided, mapFailure)
        : (provided as Effect.Effect<A, RouteFailure, never>);
      const recovered = Effect.catch(mapped, (failure) =>
        options.route.isFailure(failure)
          ? options.route.recoverFailure(failure)
          : Effect.die(failure)
      );
      const effect = options.route.withRequest(request, recovered).pipe(
        Effect.annotateLogs({
          boundary: "route",
          operation: declaration.operation,
          method: request.method.toUpperCase(),
        })
      );
      const signal =
        declaration.cancellation === "interrupt-on-disconnect"
          ? request.signal
          : undefined;

      return run(effect, signal);
    };
  }

  return { page, route, ...host };
}
