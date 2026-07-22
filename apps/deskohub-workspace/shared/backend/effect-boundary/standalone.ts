import { Cause, Effect, Exit, type Layer } from "effect";
import { makeWorkspaceEffectExecutor } from "./executor";

interface StandaloneBoundaryOptions {
  readonly operation: string;
}

const executor = makeWorkspaceEffectExecutor({
  getLoggerProvider: () => undefined,
  flushTelemetry: () => Effect.void,
});

function task<Args extends readonly unknown[], A, E>(
  options: StandaloneBoundaryOptions,
  handler: (...args: Args) => Effect.Effect<A, E, never>
): (...args: Args) => Promise<A>;
function task<Args extends readonly unknown[], A, E, R, LE>(
  options: StandaloneBoundaryOptions & {
    readonly layer: Layer.Layer<R, LE, never>;
  },
  handler: (...args: Args) => Effect.Effect<A, E, R>
): (...args: Args) => Promise<A>;
function task<Args extends readonly unknown[], A, E, R, LE>(
  options: StandaloneBoundaryOptions & {
    readonly layer?: Layer.Layer<R, LE, never>;
  },
  handler: (...args: Args) => Effect.Effect<A, E, R>
) {
  return (...args: Args) =>
    executor.runTask(
      provideLayer(
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
  options: StandaloneBoundaryOptions & { readonly signal?: AbortSignal },
  effect: Effect.Effect<A, E, never>
): Promise<A>;
function run<A, E, R, LE>(
  options: StandaloneBoundaryOptions & {
    readonly layer: Layer.Layer<R, LE, never>;
    readonly signal?: AbortSignal;
  },
  effect: Effect.Effect<A, E, R>
): Promise<A>;
async function run<A, E, R, LE>(
  options: StandaloneBoundaryOptions & {
    readonly layer?: Layer.Layer<R, LE, never>;
    readonly signal?: AbortSignal;
  },
  effect: Effect.Effect<A, E, R>
) {
  const exit = await executor.runExit(
    provideLayer(
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

const provideLayer = <A, E, R, LE>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, LE, never>
): Effect.Effect<A, E | LE, never> =>
  layer
    ? Effect.provide(effect, layer)
    : (effect as Effect.Effect<A, E | LE, never>);

export const WorkspaceEffect = { run, task };
