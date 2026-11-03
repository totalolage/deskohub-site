import { mock } from "bun:test";
import type { LogRecord } from "@opentelemetry/api-logs";
import { Effect } from "effect";
import { mockWorkspaceActionRequest } from "./workspace-action-request.test-utils";

const emittedLogRecords: LogRecord[] = [];
let installation: Promise<void> | undefined;

const installActionTelemetryMocks = async () => {
  mock.module("server-only", () => ({}));
  await mockWorkspaceActionRequest();
  mock.module("@/instrumentation", () => ({
    postHogLoggerProvider: {
      forceFlush: () => Promise.resolve(),
      getLogger: () => ({
        emit: (record: LogRecord) => {
          emittedLogRecords.push(record);
        },
      }),
    },
  }));

  const {
    defineWorkspaceAction,
    defineWorkspaceStateAction,
    workspaceActionDeadline,
  } = await import("@/shared/backend/workspace-action");
  type ActionOptions = Parameters<typeof defineWorkspaceAction>[0];

  mock.module("@/shared/backend/workspace-action", () => ({
    defineWorkspaceAction: (options: ActionOptions) =>
      defineWorkspaceAction(options, () => Effect.succeed(null)),
    defineWorkspaceStateAction: (options: ActionOptions) =>
      defineWorkspaceStateAction(options, () => Effect.succeed(null)),
    workspaceActionDeadline,
  }));
};

/**
 * Replaces each action handler with a no-op while keeping the real Workspace
 * action boundary and the action's own options, so a test can submit valid
 * input and inspect what the boundary emits to telemetry. Call before
 * importing the action module.
 */
export const mockWorkspaceActionTelemetry = async () => {
  installation ??= installActionTelemetryMocks();
  await installation;

  return {
    /** Every telemetry record emitted for one action operation. */
    getOperationLogRecords: (operation: string) =>
      emittedLogRecords.filter(
        ({ attributes }) => attributes?.operation === operation
      ),
  };
};
