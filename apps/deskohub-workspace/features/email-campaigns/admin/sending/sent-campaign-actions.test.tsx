import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { campaignIdSchema } from "../../campaign-identifiers";

mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({ push: workspaceRouterPush }),
}));

const duplicateCampaign = mock();
const retryUndeliveredCampaignRecipients = mock();

mock.module("./actions", () => ({
  duplicateCampaign,
  retryUndeliveredCampaignRecipients,
}));

const { SentCampaignActions } = await import("./sent-campaign-actions");

const campaignId = campaignIdSchema.make("synthetic-campaign");
const includeUnconfirmedLabel =
  "Also resend to unconfirmed recipients (they may receive it twice)";
const retryExecute = mock();

describe("SentCampaignActions", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  beforeEach(() => {
    retryExecute.mockClear();
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation(((
      action: typeof duplicateCampaign
    ) => ({
      execute:
        action === retryUndeliveredCampaignRecipients ? retryExecute : mock(),
      isExecuting: false,
    })) as never);
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("retries without unconfirmed recipients by default", () => {
    const view = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={2}
      />
    );

    expect(
      view
        .getByRole("checkbox", { name: includeUnconfirmedLabel })
        .getAttribute("aria-checked")
    ).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Retry undelivered" }));

    expect(retryExecute.mock.calls).toEqual([
      [{ campaignId, includeUnconfirmed: false }],
    ]);
  });

  test("includes unconfirmed recipients once the admin opts in", () => {
    const view = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={2}
      />
    );

    fireEvent.click(
      view.getByRole("checkbox", { name: includeUnconfirmedLabel })
    );
    fireEvent.click(view.getByRole("button", { name: "Retry undelivered" }));

    expect(retryExecute.mock.calls).toEqual([
      [{ campaignId, includeUnconfirmed: true }],
    ]);
  });

  test("offers the unconfirmed option only when a retry can reach them", () => {
    const withoutUnconfirmed = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable
        unconfirmedCount={0}
      />
    );
    expect(withoutUnconfirmed.queryByText(includeUnconfirmedLabel)).toBeNull();
    cleanup();

    const notRetryable = render(
      <SentCampaignActions
        campaignId={campaignId}
        retryable={false}
        unconfirmedCount={2}
      />
    );
    expect(notRetryable.queryByText(includeUnconfirmedLabel)).toBeNull();
    expect(
      notRetryable.queryByRole("button", { name: "Retry undelivered" })
    ).toBeNull();
  });
});
