import { Effect, Schedule } from "effect";
import { type WorkspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import { formatWorkspaceE2EDuration } from "./timeouts";

export const pollUntil = <A, E, R>(
  effect: Effect.Effect<A | undefined, E, R>,
  options: {
    readonly intervalMs: number;
    readonly label: string;
    readonly timeoutMs: number;
  }
): Effect.Effect<A, E | WorkspaceE2EError, R> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    let attempts = 0;
    const timeoutError = () =>
      workspaceE2ETimeoutError(
        `Timed out waiting for ${options.label} after ${attempts} attempts (${formatWorkspaceE2EDuration(Date.now() - startedAt)})`,
        { operation: options.label }
      );
    const result = yield* Effect.suspend(() => {
      attempts += 1;
      return effect;
    }).pipe(
      Effect.repeat({
        schedule: Schedule.spaced(`${options.intervalMs} millis`),
        while: (value) => value === undefined,
      }),
      Effect.timeoutOrElse({
        duration: `${options.timeoutMs} millis`,
        orElse: () => Effect.fail(timeoutError()),
      })
    );

    return yield* result === undefined
      ? Effect.fail(timeoutError())
      : Effect.succeed(result);
  });
