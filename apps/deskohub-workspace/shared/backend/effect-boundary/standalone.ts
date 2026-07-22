import { EffectBoundary } from "@deskohub/next-effect/effect-boundary";
import { Effect } from "effect";
import { createWorkspaceLoggerLive } from "../logging/censorship-core";

const executor = EffectBoundary.makeExecutor({
  transform: (effect) => Effect.provide(effect, createWorkspaceLoggerLive()),
});

export const WorkspaceEffect = EffectBoundary.makeHost(executor);
