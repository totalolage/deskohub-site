import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignIdSchema } from "../../campaign-identifiers";

mock.module("./actions", () => ({
  duplicateCampaign: mock(),
  retryUndeliveredCampaignRecipients: mock(),
  sendCampaign: mock(),
  sendCampaignTest: mock(),
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
  const { CampaignTestSendDialog } = await import(
    "./campaign-test-send-dialog"
  );
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <CampaignTestSendDialog
        adminInbox={testEmailAddress("campaign-admin-inbox")}
        campaignId={campaignIdSchema.make("synthetic-campaign")}
        contentLocales={["cs-CZ"]}
        unsavedChanges={false}
      />
    </RouteLocaleProvider>
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Poslat test" }));
  });

  expect(view.getByRole("button", { name: "Zavřít" })).toBeTruthy();
});
