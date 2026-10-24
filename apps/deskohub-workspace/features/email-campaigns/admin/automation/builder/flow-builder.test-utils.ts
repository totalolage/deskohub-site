import { mock } from "bun:test";
import { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Result, Schema } from "effect";
import { act } from "react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";

type CampaignOperationRequest = {
  readonly operation: string;
  readonly input: unknown;
};

/** Every campaign operation the builder's stubbed action hooks ran. */
const campaignOperationRequests = mock(
  (_request: CampaignOperationRequest) => undefined
);

/** Stubs the action hook under `useCampaignOperation`; nothing reaches the port. */
export const stubCampaignOperations = () => {
  campaignOperationRequests.mockClear();
  workspaceUseAction.mockImplementation(
    () => ({ execute: campaignOperationRequests, isExecuting: false }) as never
  );
};

/** Restores the shared action hook stub once a suite is done. */
export const resetCampaignOperations = () => workspaceUseAction.mockReset();

/** The inputs one campaign operation, such as a calendar preview, was run with. */
export const campaignOperationInputs = (operation: string) =>
  campaignOperationRequests.mock.calls
    .map(([request]) => request)
    .filter((request) => request.operation === operation)
    .map(({ input }) => input);

/**
 * Opens a Radix dropdown menu from the keyboard. A native event, so this
 * module doesn't load React DOM before the test registers the DOM.
 */
export const openMenu = async (trigger: HTMLElement) => {
  await act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  });
};

/**
 * Whether the admin API takes this flow, so a card's payload is checked
 * without restating the defaults it starts from.
 */
export const isValidFlow = (flow: typeof AutomationFlow.Encoded) =>
  Result.isSuccess(Schema.decodeResult(AutomationFlow)(flow));
