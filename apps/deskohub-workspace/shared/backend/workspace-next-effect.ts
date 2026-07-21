import { NextEffect, type NextEffectRouteRunner } from "@deskohub/next-effect";
import { Effect, type Layer } from "effect";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

interface WorkspaceNextEffectRuntime<R, ErrorResponse extends Response> {
  readonly route: <
    Args extends [request: Request, ...rest: Array<unknown>],
    A extends Response,
    E,
  >(
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) => (...args: Args) => Promise<A | ErrorResponse>;
}

export const makeWorkspaceNextEffect = <R, E, ErrorResponse extends Response>(
  layer: Layer.Layer<R, E, never>,
  handleRouteError: (
    error: unknown
  ) => Effect.Effect<ErrorResponse, never, never>
): WorkspaceNextEffectRuntime<R, ErrorResponse> => {
  const runWorkspaceRouteEffect = <A, RouteError>(
    request: Request,
    effect: Effect.Effect<A, RouteError, never>
  ) =>
    runWorkspaceRequestEffect(request, Effect.catch(effect, handleRouteError), {
      signal: request.signal,
    });

  return NextEffect.make({
    layer,
    // NextEffect invokes this runner only for Response-producing routes. This
    // facade exposes the application recovery response in its return union.
    runRoute: runWorkspaceRouteEffect as NextEffectRouteRunner,
  });
};
