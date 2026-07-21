import { NextEffect } from "@deskohub/next-effect";
import type { Effect, Layer } from "effect";
import { runWorkspaceRequestEffect } from "@/shared/backend/logging/censorship";

const runWorkspaceRouteEffect = <A, E>(
  request: Request,
  effect: Effect.Effect<A, E, never>
) =>
  runWorkspaceRequestEffect(request, effect, {
    signal: request.signal,
  });

export const makeWorkspaceNextEffect = <R, E>(
  layer: Layer.Layer<R, E, never>
) =>
  NextEffect.make({
    layer,
    runRoute: runWorkspaceRouteEffect,
  });
