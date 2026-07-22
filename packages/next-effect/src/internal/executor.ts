import { Cause, Effect, Exit } from "effect";
import { unstable_rethrow } from "next/navigation";

export type ExecuteRun = <A>(
  effect: Effect.Effect<A, unknown, never>
) => Promise<A>;

export interface ExecuteOptions<E> {
  readonly mapError?: (error: E) => unknown;
  readonly run?: ExecuteRun;
  readonly signal?: AbortSignal;
}

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

  const exit = await runPromiseExit(program, options.signal);
  return interpretExit(exit);
}

const runPromiseExit = async <A, E>(
  effect: Effect.Effect<A, E, never>,
  signal?: AbortSignal
): Promise<Exit.Exit<A, E>> => {
  try {
    return await Effect.runPromiseExit(effect, { signal });
  } catch (defect) {
    return Exit.die(defect);
  }
};

export function interpretExit<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) return exit.value;

  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      unstable_rethrow(reason.error);
    } else if (Cause.isDieReason(reason)) {
      unstable_rethrow(reason.defect);
    }
  }

  throw Cause.squash(exit.cause);
}
