import { Effect, Schedule } from "effect";
import { type WorkspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import { formatWorkspaceE2EDuration } from "./timeouts";

export const withinWorkspaceE2EDeadline = <A, E, R>(
  execute: Effect.Effect<A, E, R>,
  operation: string,
  timeoutMs: number
): Effect.Effect<A, E | WorkspaceE2EError, R> =>
  execute.pipe(
    Effect.timeoutOrElse({
      duration: `${timeoutMs} millis`,
      orElse: () =>
        Effect.fail(
          workspaceE2ETimeoutError(
            `Timed out running ${operation} after ${formatWorkspaceE2EDuration(timeoutMs)}`,
            { operation }
          )
        ),
    })
  );

export const pollUntil = <A, E, R>(
  effect: Effect.Effect<A | undefined, E, R>,
  options: {
    readonly describePending?: () => string | undefined;
    /** First delay of an exponential backoff that is capped at `intervalMs`. */
    readonly initialIntervalMs?: number;
    readonly intervalMs: number;
    readonly label: string;
    readonly timeoutMs: number;
  }
): Effect.Effect<A, E | WorkspaceE2EError, R> =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    let attempts = 0;
    const timeoutError = () => {
      const pending = options.describePending?.();
      return workspaceE2ETimeoutError(
        `Timed out waiting for ${options.label} after ${attempts} attempts (${formatWorkspaceE2EDuration(Date.now() - startedAt)})${pending ? `: ${pending}` : ""}`,
        { operation: options.label }
      );
    };
    const result = yield* Effect.suspend(() => {
      attempts += 1;
      return effect;
    }).pipe(
      Effect.repeat({
        schedule: pollSchedule(options),
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

const pollSchedule = ({
  initialIntervalMs,
  intervalMs,
}: {
  readonly initialIntervalMs?: number;
  readonly intervalMs: number;
}) => {
  const spaced = Schedule.spaced(`${intervalMs} millis`);
  return initialIntervalMs === undefined || initialIntervalMs >= intervalMs
    ? spaced
    : Schedule.either(
        Schedule.exponential(`${initialIntervalMs} millis`),
        spaced
      );
};
