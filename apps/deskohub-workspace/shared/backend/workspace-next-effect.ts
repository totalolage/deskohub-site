import { NextEffect, type NextEffectRouteRunner } from "@deskohub/next-effect";
import { Effect, type Layer } from "effect";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

export const makeWorkspaceNextEffect = <R, E, ErrorResponse extends Response>(
  layer: Layer.Layer<R, E, never>,
  handleRouteError: (
    error: unknown
  ) => Effect.Effect<ErrorResponse, never, never>
) => {
  const runWorkspaceRouteEffect: NextEffectRouteRunner<ErrorResponse> = (
    request,
    effect
  ) =>
    runWorkspaceRequestEffect(request, Effect.catch(effect, handleRouteError), {
      signal: request.signal,
    });

  return NextEffect.make({
    layer,
    runRoute: runWorkspaceRouteEffect,
  });
};
