import { Effect, Schedule } from "effect";
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
      times: 3,
      while: isTransientDatabaseConnectionFailure,
    }),
    Effect.mapError((cause) => toWorkspaceE2EError(operation, cause))
  );

const transientDatabaseConnectionMessages = new Set([
  "Connection closed unexpectedly",
  "Connection terminated unexpectedly",
]);

const isTransientDatabaseConnectionFailure = (cause: unknown): boolean => {
  let current = cause;
  const visited = new Set<unknown>();

  while (
    current &&
    !visited.has(current) &&
    (current instanceof Error || typeof current === "object")
  ) {
    visited.add(current);
    if (
      current instanceof Error &&
      transientDatabaseConnectionMessages.has(current.message)
    ) {
      return true;
    }
    current =
      "cause" in current
        ? (current as { readonly cause?: unknown }).cause
        : undefined;
  }

  return false;
};
