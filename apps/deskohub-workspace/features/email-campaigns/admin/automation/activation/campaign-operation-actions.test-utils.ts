import { type Mock, mock } from "bun:test";
import { act } from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import type { runCampaignOperation } from "../../campaign-operations.actions";

/** What the campaign operation action resolves with, as the port answered. */
type CampaignOperationResponse =
  | { readonly _tag: "Success"; readonly output: object }
  | {
      readonly _tag: "Failure";
      readonly code: string;
      readonly message: string;
    };

/** What `useCampaignOperation` sends through its action. */
interface CampaignOperationRequest {
  readonly operation: string;
  readonly input: object;
}

interface ActionOptions {
  readonly actionName: string;
  readonly onSuccess: (result: {
    readonly data: CampaignOperationResponse;
    readonly input: CampaignOperationRequest;
  }) => void;
}

/**
 * Captures the campaign operations a component runs through
 * `useCampaignOperation`. Mock `../../campaign-operations.actions` in the
 * test and call `install` before each render.
 */
export const captureCampaignOperations = () => {
  const actions = new Map<
    string,
    {
      readonly execute: Mock<(request: CampaignOperationRequest) => void>;
      options: ActionOptions;
    }
  >();
  const action = (operation: string) => {
    const found = actions.get(`email-campaigns.${operation}`);
    if (found === undefined) throw new Error(`${operation} isn't wired`);
    return found;
  };
  return {
    install: () => {
      actions.clear();
      workspaceUseAction.mockReset();
      workspaceUseAction.mockImplementation(((
        _action: typeof runCampaignOperation,
        options: ActionOptions
      ) => {
        const execute =
          actions.get(options.actionName)?.execute ??
          mock((_request: CampaignOperationRequest) => undefined);
        actions.set(options.actionName, { execute, options });
        return { execute, isExecuting: false };
      }) as never);
    },
    /** The requests `operation` sent, in order. */
    requests: (operation: string) =>
      action(operation).execute.mock.calls.map(([request]) => request),
    /** Settles the last request of `operation` with the port's `response`. */
    respond: (operation: string, response: CampaignOperationResponse) => {
      const { execute, options } = action(operation);
      const request = execute.mock.lastCall?.[0];
      if (request === undefined) throw new Error(`${operation} wasn't run`);
      act(() => options.onSuccess({ data: response, input: request }));
    },
  };
};
