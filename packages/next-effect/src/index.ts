import { Effect, type Exit, type Layer } from "effect";
import { type ExecuteOptions, executeExit, settle } from "./internal/executor";
import {
  makeSharedLayerProvider,
  shareAcrossRequests,
} from "./internal/shared-layer";

interface NextEffectBaseOptions {
  readonly mapError?: (error: unknown) => unknown;
}

interface NextEffectRunnableOptions extends NextEffectBaseOptions {
  readonly layer?: undefined;
}

interface NextEffectLayerOptions<R, LE> extends NextEffectBaseOptions {
  /** Built once, on first run, and shared by every later run. */
  readonly layer: Layer.Layer<R, LE, never>;
  /** Lets other runtimes reuse layers this runtime has already built. */
  readonly memoMap?: Layer.MemoMap;
}

export type NextEffectOptions<R = never, LE = never> =
  | NextEffectRunnableOptions
  | NextEffectLayerOptions<R, LE>;

interface NextEffectRunOptions {
  /** Interrupts the run when it aborts. */
  readonly signal?: AbortSignal;
}

export interface NextEffectRuntime<R> {
  /**
   * Resolves with the Effect's value. Rejects as `NextEffect.settle` throws,
   * for a failure of the run or of building the runtime's layer alike.
   */
  readonly run: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: NextEffectRunOptions
  ) => Promise<A>;
  /**
   * Resolves with the run's `Exit`, after `mapError`. A failure to build the
   * runtime's layer is a failure of this `Exit` too. Never rejects.
   */
  readonly runExit: <A, E>(
    effect: Effect.Effect<A, E, R>,
    options?: NextEffectRunOptions
  ) => Promise<Exit.Exit<A, unknown>>;
  readonly page: <Props, A, E>(
    component: (props: Props) => Effect.Effect<A, E, R>
  ) => (props: Props) => Promise<A>;
}

function makeRuntime<R>(
  runExit: NextEffectRuntime<R>["runExit"]
): NextEffectRuntime<R> {
  const run: NextEffectRuntime<R>["run"] = (effect, options) =>
    runExit(effect, options).then(settle);

  return {
    run,
    runExit,
    page: (component) => (props) => run(Effect.suspend(() => component(props))),
  };
}

const getExecuteOptions = (
  options: NextEffectBaseOptions,
  runOptions: NextEffectRunOptions | undefined
): ExecuteOptions<unknown> => ({
  mapError: options.mapError,
  signal: runOptions?.signal,
});

function make(options?: NextEffectRunnableOptions): NextEffectRuntime<never>;
function make<R, LE>(
  options: NextEffectLayerOptions<R, LE>
): NextEffectRuntime<R>;
function make<R, LE>(
  options: NextEffectOptions<R, LE> = {}
): NextEffectRuntime<R> | NextEffectRuntime<never> {
  if (options.layer) {
    const provideLayer = makeSharedLayerProvider(
      options.layer,
      options.memoMap
    );
    return makeRuntime<R>((effect, runOptions) =>
      executeExit(provideLayer(effect), getExecuteOptions(options, runOptions))
    );
  }

  return makeRuntime<never>((effect, runOptions) =>
    executeExit(effect, getExecuteOptions(options, runOptions))
  );
}

export const NextEffect = {
  make,
  settle,
  shareAcrossRequests,
};
