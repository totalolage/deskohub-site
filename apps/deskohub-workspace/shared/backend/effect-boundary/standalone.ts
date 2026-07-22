import { EffectBoundary } from "@deskohub/next-effect/effect-boundary";
import { Effect } from "effect";
import { WorkspaceLoggerLive } from "../logging/censorship";

const executor = EffectBoundary.makeExecutor({
  transform: (effect) => Effect.provide(effect, WorkspaceLoggerLive),
});

export const StandaloneWorkspaceEffect = EffectBoundary.makeHost(executor);
