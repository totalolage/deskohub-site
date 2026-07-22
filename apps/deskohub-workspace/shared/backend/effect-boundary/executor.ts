import type { EffectRunExit } from "@deskohub/next-effect";
import type { LoggerProvider } from "@opentelemetry/api-logs";
import { Cause, Effect, Exit } from "effect";
import { createWorkspaceLoggerLive } from "../logging/censorship-core";

export interface WorkspaceEffectExecutorDependencies {
  readonly getLoggerProvider: () => LoggerProvider | undefined;
  readonly flushTelemetry: () => Effect.Effect<void, never>;
}

export interface WorkspaceEffectExecutor {
  readonly runExit: EffectRunExit;
  readonly runTask: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>;
}

export const makeWorkspaceEffectExecutor = (
  dependencies: WorkspaceEffectExecutorDependencies
): WorkspaceEffectExecutor => {
  const runExit: EffectRunExit = async (effect, options) => {
    const program = Effect.suspend(() =>
      Effect.sync(dependencies.getLoggerProvider).pipe(
        Effect.flatMap((loggerProvider) =>
          Effect.provide(effect, createWorkspaceLoggerLive(loggerProvider))
        )
      )
    );

    try {
      return await Effect.runPromiseExit(program, { signal: options?.signal });
    } catch (defect) {
      return Exit.die(defect);
    }
  };

  const runTask = async <A, E>(effect: Effect.Effect<A, E, never>) => {
    const exit = await runExit(effect);
    await runExit(dependencies.flushTelemetry());

    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };

  return { runExit, runTask };
};
