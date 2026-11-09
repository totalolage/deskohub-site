import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignIdSchema } from "../../campaign-identifiers";

mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  workspaceUseAction.mockReset();
  await unregisterWorkspaceComponentTestEnv();
});

test("labels the close button in Czech on a Czech route", async () => {
  const { CampaignConfirmSendDialog } = await import(
    "./campaign-confirm-send-dialog"
  );
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <CampaignConfirmSendDialog
        campaignId={campaignIdSchema.make("synthetic-campaign")}
        unsavedChanges={false}
      />
    </RouteLocaleProvider>
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Odeslat kampaň" }));
  });

  expect(view.getByRole("button", { name: "Zavřít" })).toBeTruthy();
});
