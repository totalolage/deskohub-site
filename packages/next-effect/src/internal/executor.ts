import { Cause, Effect, Exit } from "effect";
import { unstable_rethrow } from "next/navigation";
import type { RequireOneOrNone } from "type-fest";
import type { EffectRunExit } from "../effect-boundary";

export type ExecuteRun = <A>(
  effect: Effect.Effect<A, unknown, never>
) => Promise<A>;

interface ExecuteBaseOptions<E> {
  readonly mapError?: (error: E) => unknown;
  readonly signal?: AbortSignal;
}

export type ExecuteOptions<E> = ExecuteBaseOptions<E> &
  RequireOneOrNone<
    {
      readonly run: ExecuteRun;
      readonly runExit: EffectRunExit;
    },
    "run" | "runExit"
  >;

export function execute<A, E>(
  effect: Effect.Effect<A, E, never>,
  options?: ExecuteOptions<E>
): Promise<A>;
export async function execute<A, E>(
  effect: Effect.Effect<A, E, never>,
  options: ExecuteOptions<E> = {}
): Promise<A> {
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
