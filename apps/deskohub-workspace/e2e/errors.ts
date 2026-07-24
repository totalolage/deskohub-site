import { Data, Effect } from "effect";
import { redact } from "./runtime";

export class WorkspaceE2EError extends Data.TaggedError("WorkspaceE2EError")<{
  readonly cause?: unknown;
  readonly causes?: readonly unknown[];
  readonly message: string;
  readonly operation?: string;
  readonly reason?: "timeout";
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

export const workspaceE2ETimeoutError = (
  message: string,
  options: {
    readonly operation?: string;
  } = {}
) => new WorkspaceE2EError({ message, ...options, reason: "timeout" });

export const failWorkspaceE2E = (
  message: string,
  options: {
    readonly cause?: unknown;
    readonly causes?: readonly unknown[];
    readonly operation?: string;
  } = {}
) => Effect.fail(workspaceE2EError(message, options));

export const isWorkspaceE2ETimeout = (
  cause: unknown,
  seen: Set<unknown> = new Set()
): boolean => {
  if (!cause || (typeof cause !== "object" && typeof cause !== "function"))
    return false;
  if (seen.has(cause)) return false;
  seen.add(cause);

  if (cause instanceof WorkspaceE2EError) {
    if (cause.reason === "timeout") return true;
    if (cause.cause !== undefined && isWorkspaceE2ETimeout(cause.cause, seen))
      return true;
    return (
      cause.causes?.some((nestedCause) =>
        isWorkspaceE2ETimeout(nestedCause, seen)
      ) ?? false
    );
  }

  if (cause instanceof AggregateError)
    return cause.errors.some((error) => isWorkspaceE2ETimeout(error, seen));
  if (cause instanceof Error && cause.cause !== undefined)
    return isWorkspaceE2ETimeout(cause.cause, seen);
  return false;
};

export const tryWorkspaceE2EPromise = <A>(
  operation: string,
  try_: (signal: AbortSignal) => Promise<A>
) =>
  Effect.tryPromise({
    catch: (cause) => toWorkspaceE2EError(operation, cause),
    try: try_,
  });

export const tryWorkspaceE2ESync = <A>(operation: string, try_: () => A) =>
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
