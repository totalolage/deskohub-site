import { Cause, Effect, Exit } from "effect";
import { unstable_rethrow } from "next/navigation";

export type ExecuteRun = <A>(
  effect: Effect.Effect<A, unknown, never>
) => Promise<A>;

export type EffectRunExit = <A, E>(
  effect: Effect.Effect<A, E, never>,
  options?: { readonly signal?: AbortSignal }
) => Promise<Exit.Exit<A, E>>;

interface ExecuteBaseOptions<E> {
  readonly mapError?: (error: E) => unknown;
  readonly signal?: AbortSignal;
}

export type ExecuteOptions<E> = ExecuteBaseOptions<E> &
  (
    | {
        readonly run?: ExecuteRun;
        readonly runExit?: never;
      }
    | {
        readonly run?: never;
        readonly runExit: EffectRunExit;
      }
  );

export interface ExecuteRecoveryOptions<A, E, ErrorResult>
  extends ExecuteBaseOptions<E> {
  readonly run: (
    effect: Effect.Effect<A, unknown, never>
  ) => Promise<A | ErrorResult>;
}

export function execute<A, E>(
  effect: Effect.Effect<A, E, never>,
  options?: ExecuteOptions<E>
): Promise<A>;
export function execute<A, E, ErrorResult>(
  effect: Effect.Effect<A, E, never>,
  options: ExecuteRecoveryOptions<A, E, ErrorResult>
): Promise<A | ErrorResult>;
export async function execute<A, E, ErrorResult = never>(
  effect: Effect.Effect<A, E, never>,
  options: ExecuteOptions<E> | ExecuteRecoveryOptions<A, E, ErrorResult> = {}
): Promise<A | ErrorResult> {
  const program = options.mapError
    ? Effect.mapError(effect, options.mapError)
    : effect;

  if (options.run) {
    return options.run(program);
  }

  const exit = await runExit(program, {
    runExit: "runExit" in options ? options.runExit : undefined,
    signal: options.signal,
  });

  return interpretExit(exit);
}

async function runExit<A, E>(
  effect: Effect.Effect<A, E, never>,
  options: {
    readonly runExit?: EffectRunExit;
    readonly signal?: AbortSignal;
  }
): Promise<Exit.Exit<A, E>> {
  try {
    const injectedRunExit = options.runExit;
    return injectedRunExit
      ? await Promise.resolve().then(() =>
          injectedRunExit(effect, { signal: options.signal })
        )
      : await Effect.runPromiseExit(effect, { signal: options.signal });
  } catch (defect) {
    return Exit.die(defect);
  }
}

export function interpretExit<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      unstable_rethrow(reason.error);
    } else if (Cause.isDieReason(reason)) {
      unstable_rethrow(reason.defect);
    }
  }

  throw Cause.squash(exit.cause);
}
