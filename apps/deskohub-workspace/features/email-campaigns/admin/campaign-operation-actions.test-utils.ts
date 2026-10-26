import { act } from "@testing-library/react";
import { useRef, useState } from "react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import type { runCampaignOperation } from "./campaign-operations.actions";

/** What the campaign operation action resolves with, as the port answered. */
type CampaignOperationResponse =
  | { readonly _tag: "Success"; readonly output: object }
  | {
      readonly _tag: "Failure";
      readonly category?: string;
      readonly code: string;
      readonly message: string;
    };

/** What `useCampaignOperation` sends through its action. */
interface CampaignOperationRequest {
  readonly operation: string;
  readonly input: object;
}

interface ActionOptions {
  readonly onSuccess: (result: {
    readonly data: CampaignOperationResponse;
    readonly input: CampaignOperationRequest;
  }) => void;
}

interface CampaignOperationRun {
  readonly request: CampaignOperationRequest;
  readonly settle: (response: CampaignOperationResponse) => void;
}

/**
 * Captures the campaign operations a component runs through
 * `useCampaignOperation`. Mock `campaign-operations.actions` in the test and
 * call `install` before each render.
 *
 * Every operation shares one action, so a run is told apart by the operation
 * its request names. Each hook executes from its run until the run settles.
 */
export const captureCampaignOperations = () => {
  const runs: CampaignOperationRun[] = [];
  const runsOf = (operation: string) =>
    runs.filter(({ request }) => request.operation === operation);

  function useCampaignOperationAction(
    _action: typeof runCampaignOperation,
    options: ActionOptions
  ) {
    // The action reports to the callbacks of the hook's latest render.
    const latestOptions = useRef(options);
    latestOptions.current = options;
    const [isExecuting, setExecuting] = useState(false);
    return {
      execute: (request: CampaignOperationRequest) => {
        setExecuting(true);
        runs.push({
          request,
          settle: (response) => {
            setExecuting(false);
            latestOptions.current.onSuccess({ data: response, input: request });
          },
        });
      },
      isExecuting,
    };
  }

  return {
    install: () => {
      runs.length = 0;
      workspaceUseAction.mockReset();
      workspaceUseAction.mockImplementation(
        useCampaignOperationAction as never
      );
    },
    /** The requests `operation` sent, in order. */
    requests: (operation: string) =>
      runsOf(operation).map(({ request }) => request),
    /** Settles the last request of `operation` with the port's `response`. */
    respond: (operation: string, response: CampaignOperationResponse) => {
      const run = runsOf(operation).at(-1);
      if (run === undefined) throw new Error(`${operation} wasn't run`);
      act(() => run.settle(response));
    },
  };
};
