import { Cause, Effect, Schedule } from "effect";
import {
  toWorkspaceE2EError,
  type WorkspaceE2EError,
} from "../errors";

export const runDatabaseOperation = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, WorkspaceE2EError, R> =>
  effect.pipe(
    Effect.mapError((cause) => toWorkspaceE2EError(operation, cause))
  );

export const runRetrySafeDatabaseOperation = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, WorkspaceE2EError, R> =>
  effect.pipe(
    Effect.retry({
      schedule: Schedule.spaced("250 millis"),
      times: 20,
      while: isTransientDatabaseConnectionFailure,
    }),
    Effect.mapError((cause) => toWorkspaceE2EError(operation, cause))
  );

const transientDatabaseConnectionMessages = new Set([
  "Connection closed unexpectedly",
  "Connection terminated unexpectedly",
]);

const isTransientDatabaseConnectionFailure = (
  cause: unknown,
  visited: Set<unknown> = new Set()
): boolean => {
  if (
    !cause ||
    visited.has(cause) ||
    (typeof cause !== "object" && typeof cause !== "function")
  ) {
    return false;
  }
  visited.add(cause);

  if (Cause.isCause(cause)) {
    return Cause.prettyErrors(cause).some((error) =>
      isTransientDatabaseConnectionFailure(error, visited)
    );
  }

  if (
    cause instanceof Error &&
    transientDatabaseConnectionMessages.has(cause.message)
  ) {
    return true;
  }

  return (
    "cause" in cause &&
    isTransientDatabaseConnectionFailure(
      (cause as { readonly cause?: unknown }).cause,
      visited
    )
  );
};
