import { Cause, Effect, Exit } from "effect";
import { unstable_rethrow } from "next/navigation";

export interface ExecuteOptions<E> {
  readonly mapError?: (error: E) => unknown;
  readonly signal?: AbortSignal;
}

/**
 * Runs `effect` to its `Exit`, failures and defects included, after
 * `mapError`. Never rejects.
 */
export const executeExit = <A, E>(
  effect: Effect.Effect<A, E, never>,
  options: ExecuteOptions<E> = {}
): Promise<Exit.Exit<A, unknown>> =>
  runPromiseExit(
    options.mapError ? Effect.mapError(effect, options.mapError) : effect,
    options.signal
  );

export const execute = <A, E>(
  effect: Effect.Effect<A, E, never>,
  options: ExecuteOptions<E> = {}
): Promise<A> => executeExit(effect, options).then(settle);

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

/**
 * The value of a successful `exit`. A failed one throws: Next.js control flow
 * it carries (a redirect, `notFound`, a prerender bailout) unchanged, and
 * otherwise its squashed cause.
 */
export function settle<A, E>(exit: Exit.Exit<A, E>): A {
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
