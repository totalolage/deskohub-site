import { NextEffect } from "@deskohub/next-effect";
import {
  EffectAction,
  type EffectActionArgs,
} from "@deskohub/next-effect/effect-action";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Cause, Duration, Effect, Exit, type Layer, References } from "effect";
import type {
  FlattenedValidationErrors,
  SafeActionFn,
  ValidationErrors,
} from "next-safe-action";
import type { Locale } from "@/features/i18n";
import { formatError } from "@/shared/utils/error-formatting";
import {
  actionClient,
  getPublicSafeActionErrorMessage,
  PublicSafeActionError,
} from "@/shared/utils/safe-action-client";
import type { WorkspaceEffectExecutor } from "./executor";
import { withWorkspaceRequestContext } from "./request-context";
import {
  recoverWorkspaceRouteFailure,
  type WorkspaceRouteErrorResponse,
  WorkspaceRouteFailure,
} from "./route-failure";

export interface WorkspaceBoundaryOptions {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
}

export type WorkspaceRequestCancellation =
  | "interrupt-on-disconnect"
  | "continue-after-disconnect";

export type WorkspaceRouteFailureMapping<F> = [F] extends [never]
  ? { readonly mapFailure?: never }
  : [F] extends [WorkspaceRouteFailure]
    ? {
        readonly mapFailure?: (failure: F) => WorkspaceRouteFailure;
      }
    : {
        readonly mapFailure: (failure: F) => WorkspaceRouteFailure;
      };

type WorkspaceRouteBaseOptions<E> = WorkspaceBoundaryOptions & {
  readonly cancellation: WorkspaceRequestCancellation;
} & WorkspaceRouteFailureMapping<E>;

type WorkspaceRouteLayerOptions<R, LE, E> = WorkspaceRouteBaseOptions<
  E | LE
> & {
  readonly layer: Layer.Layer<R, LE, never>;
};

export type WorkspaceSafeActionArgs<S extends StandardSchemaV1> =
  EffectActionArgs<S, { readonly locale: Locale }, unknown>;

export type WorkspaceSafeAction<S extends StandardSchemaV1, A> = SafeActionFn<
  string,
  S,
  readonly [],
  FlattenedValidationErrors<ValidationErrors<S>>,
  A
>;

export interface WorkspaceEffectDependencies {
  readonly executor: WorkspaceEffectExecutor;
  readonly readActionHeaders: () => Effect.Effect<Headers, never>;
  readonly scheduleTelemetryFlush: () => Effect.Effect<void, never>;
}

export interface WorkspaceEffectFacade {
  readonly page: {
    <Props, A>(
      options: WorkspaceBoundaryOptions,
      render: (props: Props) => Effect.Effect<A, never, never>
    ): (props: Props) => Promise<A>;
    <Props, A, R>(
      options: WorkspaceBoundaryOptions & {
        readonly layer: Layer.Layer<R, never, never>;
      },
      render: (props: Props) => Effect.Effect<A, never, R>
    ): (props: Props) => Promise<A>;
  };
  readonly route: {
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
    >(
      options: WorkspaceRouteBaseOptions<E>,
      handler: (...args: Args) => Effect.Effect<A, E, never>
    ): (...args: Args) => Promise<A | WorkspaceRouteErrorResponse>;
    <
      Args extends [request: Request, ...rest: readonly unknown[]],
      A extends Response,
      E,
      R,
      LE,
    >(
      options: WorkspaceRouteLayerOptions<R, LE, E>,
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A | WorkspaceRouteErrorResponse>;
  };
  readonly action: {
    <Args extends readonly unknown[], A>(
      options: WorkspaceBoundaryOptions,
      handler: (...args: Args) => Effect.Effect<A, never, never>
    ): (...args: Args) => Promise<A>;
    <Args extends readonly unknown[], A, R>(
      options: WorkspaceBoundaryOptions & {
        readonly layer: Layer.Layer<R, never, never>;
      },
      handler: (...args: Args) => Effect.Effect<A, never, R>
    ): (...args: Args) => Promise<A>;
  };
  readonly safeAction: {
    <S extends StandardSchemaV1, A, E>(
      options: WorkspaceBoundaryOptions & {
        readonly schema: S;
      },
      handler: (args: WorkspaceSafeActionArgs<S>) => Effect.Effect<A, E, never>
    ): WorkspaceSafeAction<S, A>;
    <S extends StandardSchemaV1, A, E, R, LE>(
      options: WorkspaceBoundaryOptions & {
        readonly schema: S;
        readonly layer: Layer.Layer<R, LE, never>;
      },
      handler: (args: WorkspaceSafeActionArgs<S>) => Effect.Effect<A, E, R>
    ): WorkspaceSafeAction<S, A>;
  };
  readonly task: {
    <Args extends readonly unknown[], A, E>(
      options: WorkspaceBoundaryOptions,
      handler: (...args: Args) => Effect.Effect<A, E, never>
    ): (...args: Args) => Promise<A>;
    <Args extends readonly unknown[], A, E, R, LE>(
      options: WorkspaceBoundaryOptions & {
        readonly layer: Layer.Layer<R, LE, never>;
      },
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A>;
  };
  readonly run: {
    <A, E>(
      options: WorkspaceBoundaryOptions & {
        readonly signal?: AbortSignal;
      },
      effect: Effect.Effect<A, E, never>
    ): Promise<A>;
    <A, E, R, LE>(
      options: WorkspaceBoundaryOptions & {
        readonly layer: Layer.Layer<R, LE, never>;
        readonly signal?: AbortSignal;
      },
      effect: Effect.Effect<A, E, R>
    ): Promise<A>;
  };
}

export const makeWorkspaceEffect = (
  dependencies: WorkspaceEffectDependencies
): WorkspaceEffectFacade => {
  const next = NextEffect.make({ runExit: dependencies.executor.runExit });

  function page<Props, A>(
    options: WorkspaceBoundaryOptions,
    render: (props: Props) => Effect.Effect<A, never, never>
  ): (props: Props) => Promise<A>;
  function page<Props, A, R>(
    options: WorkspaceBoundaryOptions & {
      readonly layer: Layer.Layer<R, never, never>;
    },
    render: (props: Props) => Effect.Effect<A, never, R>
  ): (props: Props) => Promise<A>;
  function page<Props, A, R>(
    options: WorkspaceBoundaryOptions & {
      readonly layer?: Layer.Layer<R, never, never>;
    },
    render: (props: Props) => Effect.Effect<A, never, R>
  ) {
    return next.page((props: Props) =>
      provideBoundaryLayer(
        Effect.suspend(() => render(props)),
        options.layer
      ).pipe(
        Effect.annotateLogs({
          boundary: "page",
          operation: options.operation,
        })
      )
    );
  }

  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
  >(
    options: WorkspaceRouteBaseOptions<E>,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ): (...args: Args) => Promise<A | WorkspaceRouteErrorResponse>;
  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
    R,
    LE,
  >(
    options: WorkspaceRouteLayerOptions<R, LE, E>,
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ): (...args: Args) => Promise<A | WorkspaceRouteErrorResponse>;
  function route<
    Args extends [request: Request, ...rest: readonly unknown[]],
    A extends Response,
    E,
    R,
    LE,
  >(
    options: WorkspaceRouteBaseOptions<E | LE> & {
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) {
    return next.route(
      {
        signal:
          options.cancellation === "interrupt-on-disconnect"
            ? (...args: Args) => args[0].signal
            : undefined,
      },
      (...args: Args) => {
        const request = args[0];
        const provided = provideBoundaryLayer(
          Effect.suspend(() => handler(...args)),
          options.layer
        );
        const mapFailure = options.mapFailure as
          | ((failure: E | LE) => WorkspaceRouteFailure)
          | undefined;
        const mapped = mapFailure
          ? Effect.mapError(provided, mapFailure)
          : (provided as Effect.Effect<A, WorkspaceRouteFailure, never>);
        const recovered = Effect.catch(mapped, (failure) =>
          failure instanceof WorkspaceRouteFailure
            ? recoverWorkspaceRouteFailure(failure)
            : Effect.die(failure)
        );

        return Effect.andThen(
          dependencies.scheduleTelemetryFlush(),
          withWorkspaceRequestContext(request.headers, recovered)
        ).pipe(
          Effect.annotateLogs({
            boundary: "route",
            operation: options.operation,
            method: request.method.toUpperCase(),
          })
        );
      }
    );
  }

  function action<Args extends readonly unknown[], A>(
    options: WorkspaceBoundaryOptions,
    handler: (...args: Args) => Effect.Effect<A, never, never>
  ): (...args: Args) => Promise<A>;
  function action<Args extends readonly unknown[], A, R>(
    options: WorkspaceBoundaryOptions & {
      readonly layer: Layer.Layer<R, never, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, never, R>
  ): (...args: Args) => Promise<A>;
  function action<Args extends readonly unknown[], A, R>(
    options: WorkspaceBoundaryOptions & {
      readonly layer?: Layer.Layer<R, never, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, never, R>
  ) {
    return next.action((...args: Args) =>
      Effect.andThen(
        dependencies.scheduleTelemetryFlush(),
        dependencies.readActionHeaders().pipe(
          Effect.flatMap((headers) =>
            withWorkspaceRequestContext(
              headers,
              provideBoundaryLayer(
                Effect.suspend(() => handler(...args)),
                options.layer
              )
            )
          )
        )
      ).pipe(
        Effect.annotateLogs({
          boundary: "action",
          operation: options.operation,
        })
      )
    );
  }

  function safeAction<S extends StandardSchemaV1, A, E>(
    options: WorkspaceBoundaryOptions & { readonly schema: S },
    handler: (args: WorkspaceSafeActionArgs<S>) => Effect.Effect<A, E, never>
  ): WorkspaceSafeAction<S, A>;
  function safeAction<S extends StandardSchemaV1, A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly schema: S;
      readonly layer: Layer.Layer<R, LE, never>;
    },
    handler: (args: WorkspaceSafeActionArgs<S>) => Effect.Effect<A, E, R>
  ): WorkspaceSafeAction<S, A>;
  function safeAction<S extends StandardSchemaV1, A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly schema: S;
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (args: WorkspaceSafeActionArgs<S>) => Effect.Effect<A, E, R>
  ): WorkspaceSafeAction<S, A> {
    const effectAction = EffectAction.fromClient(actionClient, {
      runExit: dependencies.executor.runExit,
    });

    return effectAction.inputSchema(options.schema).action((args) => {
      const invocation = dependencies.readActionHeaders().pipe(
        Effect.flatMap((headers) => {
          const provided = provideBoundaryLayer(
            Effect.suspend(() => handler(args)),
            options.layer
          );
          const logged = Effect.gen(function* () {
            yield* Effect.logDebug("Safe action executed").pipe(
              Effect.annotateLogs({
                locale: args.ctx.locale,
                input: args.parsedInput,
              })
            );
            const result = yield* provided;
            yield* Effect.logDebug("Action completed successfully");
            return result;
          }).pipe(
            Effect.tapError((error) =>
              Effect.logError("Action failed").pipe(
                Effect.annotateLogs({ error })
              )
            ),
            Effect.mapError(mapSafeActionFailure),
            Effect.withSpan("safeAction", {
              attributes: { "action.locale": args.ctx.locale },
            })
          );

          return withWorkspaceRequestContext(headers, logged);
        }),
        Effect.provideService(References.MinimumLogLevel, "All"),
        Effect.annotateLogs({
          boundary: "safe-action",
          operation: options.operation,
        }),
        Effect.timeoutOrElse({
          duration: Duration.seconds(45),
          orElse: () =>
            Effect.fail(
              new PublicSafeActionError({
                message: "Request timed out. Please try again.",
              })
            ),
        })
      );

      return Effect.andThen(dependencies.scheduleTelemetryFlush(), invocation);
    }) as WorkspaceSafeAction<S, A>;
  }

  function task<Args extends readonly unknown[], A, E>(
    options: WorkspaceBoundaryOptions,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ): (...args: Args) => Promise<A>;
  function task<Args extends readonly unknown[], A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly layer: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ): (...args: Args) => Promise<A>;
  function task<Args extends readonly unknown[], A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) {
    return (...args: Args) =>
      dependencies.executor.runTask(
        provideBoundaryLayer(
          Effect.suspend(() => handler(...args)),
          options.layer
        ).pipe(
          Effect.annotateLogs({
            boundary: "task",
            operation: options.operation,
          })
        )
      );
  }

  function run<A, E>(
    options: WorkspaceBoundaryOptions & { readonly signal?: AbortSignal },
    effect: Effect.Effect<A, E, never>
  ): Promise<A>;
  function run<A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly layer: Layer.Layer<R, LE, never>;
      readonly signal?: AbortSignal;
    },
    effect: Effect.Effect<A, E, R>
  ): Promise<A>;
  async function run<A, E, R, LE>(
    options: WorkspaceBoundaryOptions & {
      readonly layer?: Layer.Layer<R, LE, never>;
      readonly signal?: AbortSignal;
    },
    effect: Effect.Effect<A, E, R>
  ) {
    const exit = await dependencies.executor.runExit(
      provideBoundaryLayer(
        Effect.suspend(() => effect),
        options.layer
      ).pipe(
        Effect.annotateLogs({
          boundary: "run",
          operation: options.operation,
        })
      ),
      { signal: options.signal }
    );

    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  }

  return { page, route, action, safeAction, task, run };
};

const provideBoundaryLayer = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  layer
    ? Effect.provide(effect, layer)
    : (effect as Effect.Effect<A, E | LE, never>);

const mapSafeActionFailure = (error: unknown) => {
  const publicMessage = getPublicSafeActionErrorMessage(error);
  if (publicMessage) {
    return new PublicSafeActionError({ message: publicMessage, cause: error });
  }

  const formatted = formatError(error);
  return new Error(formatted.code || "INTERNAL_ACTION_ERROR", {
    cause: error,
  });
};
