import { Cause, Effect, Exit } from "effect";
import { unstable_rethrow } from "next/navigation";

export type ExecuteRun = <A>(
  effect: Effect.Effect<A, unknown, never>
) => Promise<A>;

interface ExecuteBaseOptions<E> {
  readonly mapError?: (error: E) => unknown;
  readonly signal?: AbortSignal;
}

export interface ExecuteOptions<E> extends ExecuteBaseOptions<E> {
  readonly run?: ExecuteRun;
}

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

  const exit = await Effect.runPromiseExit(program, { signal: options.signal });

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      unstable_rethrow(reason.error);
      throw reason.error;
    } else if (Cause.isDieReason(reason)) {
      unstable_rethrow(reason.defect);
    }
  }

  throw Cause.squash(exit.cause);
}
