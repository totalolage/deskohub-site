"use client";

import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  type HookBaseOptions,
  type SingleInputActionFn,
  type UseActionHookReturn,
  useAction,
} from "next-safe-action/hooks";
import posthog from "posthog-js";
import { useCallback } from "react";

type WorkspaceActionTransportErrorInput<
  Schema extends StandardSchemaV1 | undefined,
> = Schema extends StandardSchemaV1
  ? StandardSchemaV1.InferInput<Schema>
  : undefined;

type UseWorkspaceActionOptions<
  ServerError,
  Schema extends StandardSchemaV1 | undefined,
  ShapedErrors,
  Data,
> = HookBaseOptions<ServerError, Schema, ShapedErrors, Data> & {
  readonly actionName: string;
  readonly onTransportError?: (args: {
    readonly error: unknown;
    readonly input: WorkspaceActionTransportErrorInput<Schema>;
  }) => void;
};

const getTransportErrorDetails = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: typeof error,
    message: String(error),
  };
};

const captureTransportError = ({
  actionName,
  error,
}: {
  readonly actionName: string;
  readonly error: unknown;
}) => {
  const details = getTransportErrorDetails(error);

  try {
    posthog.capture("workspace_safe_action_transport_error", {
      actionName,
      errorName: details.name,
      errorMessage: details.message,
      path: globalThis.location?.pathname,
    });
  } catch {}
};

export function useWorkspaceAction<
  ServerError,
  Schema extends StandardSchemaV1 | undefined,
  ShapedErrors,
  Data,
>(
  safeActionFn: SingleInputActionFn<ServerError, Schema, ShapedErrors, Data>,
  opts: UseWorkspaceActionOptions<ServerError, Schema, ShapedErrors, Data>
): UseActionHookReturn<ServerError, Schema, ShapedErrors, Data> {
  const { actionName, onTransportError, ...hookOptions } = opts;
  const action = useAction(safeActionFn, hookOptions);

  const handleTransportError = useCallback(
    (error: unknown, input: WorkspaceActionTransportErrorInput<Schema>) => {
      captureTransportError({ actionName, error });
      try {
        onTransportError?.({ error, input });
      } catch {}
    },
    [actionName, onTransportError]
  );

  const executeAsync = useCallback(
    async (input: Parameters<typeof action.executeAsync>[0]) => {
      try {
        return await action.executeAsync(input);
      } catch (error) {
        handleTransportError(
          error,
          input as WorkspaceActionTransportErrorInput<Schema>
        );
        throw error;
      }
    },
    [action, handleTransportError]
  );

  const execute = useCallback(
    (input: Parameters<typeof action.execute>[0]) => {
      void executeAsync(input).catch(() => undefined);
    },
    [executeAsync]
  );

  return {
    ...action,
    execute,
    executeAsync,
  };
}
