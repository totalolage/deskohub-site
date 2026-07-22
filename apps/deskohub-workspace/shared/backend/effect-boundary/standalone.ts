import { EffectBoundary } from "@deskohub/next-effect/effect-boundary";
import { Effect } from "effect";
import { createWorkspaceLoggerLive } from "../logging/censorship";

const executor = EffectBoundary.makeExecutor({
  transform: (effect) => Effect.provide(effect, createWorkspaceLoggerLive()),
});

export const StandaloneWorkspaceEffect = EffectBoundary.makeHost(executor);
