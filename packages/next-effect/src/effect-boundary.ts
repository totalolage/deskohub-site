import { Cause, Effect, Exit, type Layer } from "effect";
import { provideBoundaryLayer } from "./internal/boundary";
import type { EffectRunExit } from "./internal/executor";

export interface EffectBoundaryExecutor {
  readonly runExit: EffectRunExit;
  readonly runTask: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>;
}

export type EffectBoundaryTransform = <A, E>(
  effect: Effect.Effect<A, E, never>
) => Effect.Effect<A, E, never>;

export interface EffectBoundaryExecutorOptions {
  readonly transform?: EffectBoundaryTransform;
  readonly completeTask?: () => Effect.Effect<void, never>;
}

export interface EffectBoundaryOptions {
  /** Stable, low-cardinality name without IDs, URLs, or payload data. */
  readonly operation: string;
}

export interface EffectHostBoundary {
  readonly task: {
    <Args extends readonly unknown[], A, E>(
      options: EffectBoundaryOptions,
      handler: (...args: Args) => Effect.Effect<A, E, never>
    ): (...args: Args) => Promise<A>;
    <Args extends readonly unknown[], A, E, R, LE>(
      options: EffectBoundaryOptions & {
        readonly layer: Layer.Layer<R, LE, never>;
      },
      handler: (...args: Args) => Effect.Effect<A, E, R>
    ): (...args: Args) => Promise<A>;
  };
  readonly run: {
    <A, E>(
      options: EffectBoundaryOptions & { readonly signal?: AbortSignal },
      effect: Effect.Effect<A, E, never>
    ): Promise<A>;
    <A, E, R, LE>(
      options: EffectBoundaryOptions & {
        readonly layer: Layer.Layer<R, LE, never>;
        readonly signal?: AbortSignal;
      },
      effect: Effect.Effect<A, E, R>
    ): Promise<A>;
  };
}

const makeExecutor = (
  options: EffectBoundaryExecutorOptions = {}
): EffectBoundaryExecutor => {
  const runExit: EffectRunExit = async (effect, runOptions) => {
    const program = Effect.suspend(() =>
      options.transform ? options.transform(effect) : effect
    );

    try {
      return await Effect.runPromiseExit(program, {
        signal: runOptions?.signal,
      });
    } catch (defect) {
      return Exit.die(defect);
    }
  };

  const runTask = async <A, E>(effect: Effect.Effect<A, E, never>) => {
    const exit = await runExit(effect);
    await runExit(
      Effect.suspend(() => options.completeTask?.() ?? Effect.void)
    );

    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };

  return { runExit, runTask };
};

const makeHost = (executor: EffectBoundaryExecutor): EffectHostBoundary => {
  function task<Args extends readonly unknown[], A, E>(
    options: EffectBoundaryOptions,
    handler: (...args: Args) => Effect.Effect<A, E, never>
  ): (...args: Args) => Promise<A>;
  function task<Args extends readonly unknown[], A, E, R, LE>(
    options: EffectBoundaryOptions & {
      readonly layer: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ): (...args: Args) => Promise<A>;
  function task<Args extends readonly unknown[], A, E, R, LE>(
    options: EffectBoundaryOptions & {
      readonly layer?: Layer.Layer<R, LE, never>;
    },
    handler: (...args: Args) => Effect.Effect<A, E, R>
  ) {
    return (...args: Args) =>
      executor.runTask(
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
    options: EffectBoundaryOptions & { readonly signal?: AbortSignal },
    effect: Effect.Effect<A, E, never>
  ): Promise<A>;
  function run<A, E, R, LE>(
    options: EffectBoundaryOptions & {
      readonly layer: Layer.Layer<R, LE, never>;
      readonly signal?: AbortSignal;
    },
    effect: Effect.Effect<A, E, R>
  ): Promise<A>;
  async function run<A, E, R, LE>(
    options: EffectBoundaryOptions & {
      readonly layer?: Layer.Layer<R, LE, never>;
      readonly signal?: AbortSignal;
    },
    effect: Effect.Effect<A, E, R>
  ) {
    const exit = await executor.runExit(
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

  return { task, run };
};

export const EffectBoundary = {
  makeExecutor,
  makeHost,
};
