import { Data, Effect } from "effect";
import { redact } from "./runtime";

export class WorkspaceE2EError extends Data.TaggedError("WorkspaceE2EError")<{
  readonly cause?: unknown;
  readonly causes?: readonly unknown[];
  readonly message: string;
  readonly operation?: string;
}> {}

export const toWorkspaceE2EError = (operation: string, cause: unknown) =>
  cause instanceof WorkspaceE2EError
    ? cause
    : new WorkspaceE2EError({
        cause,
        message: `${operation} failed: ${getCauseMessage(cause)}`,
        operation,
      });

export const workspaceE2EError = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly causes?: readonly unknown[];
    readonly operation?: string;
  } = {}
) => new WorkspaceE2EError({ message, ...options });

export const failWorkspaceE2E = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly causes?: readonly unknown[];
    readonly operation?: string;
  } = {}
) => Effect.fail(workspaceE2EError(message, options));

export const effectifyPromise = <A>(
  operation: string,
  try_: () => Promise<A>
) =>
  Effect.tryPromise({
    catch: (cause) => toWorkspaceE2EError(operation, cause),
    try: try_,
  });

export const effectifySync = <A>(operation: string, try_: () => A) =>
  Effect.try({
    catch: (cause) => toWorkspaceE2EError(operation, cause),
    try: try_,
  });

export const formatWorkspaceE2EFailure = (cause: unknown) =>
  redact(formatUnknownFailure(cause, new Set()));

const formatUnknownFailure = (cause: unknown, seen: Set<unknown>): string => {
  if (seen.has(cause)) return "[circular cause]";
  if (cause && typeof cause === "object") seen.add(cause);

  if (cause instanceof WorkspaceE2EError) {
    const parts = [cause.stack ?? cause.message];
    if (cause.causes?.length) {
      parts.push(
        "Causes:",
        ...cause.causes.map((nestedCause, index) =>
          indent(`${index + 1}. ${formatUnknownFailure(nestedCause, seen)}`)
        )
      );
    } else if (cause.cause !== undefined) {
      parts.push("Caused by:", indent(formatUnknownFailure(cause.cause, seen)));
    }
    return parts.join("\n");
  }

  if (cause instanceof AggregateError) {
    return [
      cause.stack ?? cause.message,
      "Causes:",
      ...cause.errors.map((nestedCause, index) =>
        indent(`${index + 1}. ${formatUnknownFailure(nestedCause, seen)}`)
      ),
    ].join("\n");
  }

  if (cause instanceof Error) return cause.stack ?? cause.message;
  return String(cause);
};

const getCauseMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

const indent = (value: string) =>
  value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
