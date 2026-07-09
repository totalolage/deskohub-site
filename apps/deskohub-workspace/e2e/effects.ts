import { Effect, Schedule } from "effect";
import { type WorkspaceE2EError, workspaceE2EError } from "./errors";
import { POLL_INTERVAL_MS } from "./runtime";

export const pollEffect = <A, E, R>(
  effect: Effect.Effect<A | undefined, E, R>,
  timeoutMs: number,
  label: string
): Effect.Effect<A, E | WorkspaceE2EError, R> =>
  effect.pipe(
    Effect.repeat({
      schedule: Schedule.spaced(`${POLL_INTERVAL_MS} millis`),
      while: (result) => result === undefined,
    }),
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          workspaceE2EError(`Timed out waiting for ${label}`, {
            operation: label,
          })
        ),
    }),
    Effect.flatMap((result) =>
      result === undefined
        ? Effect.fail(
            workspaceE2EError(`Timed out waiting for ${label}`, {
              operation: label,
            })
          )
        : Effect.succeed(result)
    )
  );
