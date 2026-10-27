import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, render, within } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const locale = "en-US";

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: async () => locale,
}));
mock.module("next/navigation", () => ({
  useParams: () => ({ locale }),
  useRouter: () => ({ push: () => undefined }),
  // The administration's browser Effects rethrow only Next control flow,
  // which this page never raises.
  unstable_rethrow: () => {},
}));

registerWorkspaceComponentTestEnv();

const { CampaignListPage } = await import("./campaign-list-page");

describe("CampaignListPage", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("keeps the delivery filter and the new-campaign action on the count's row", async () => {
    const page = await CampaignListPage({
      campaigns: Promise.resolve([]),
      delivery: Promise.resolve(undefined),
    });
    const view = await act(async () =>
      render(<RouteLocaleProvider locale={locale}>{page}</RouteLocaleProvider>)
    );
    const region = view.getByRole("region", {
      name: m.emailCampaignsListTableControls({}, { locale }),
    });
    const row = region.firstElementChild;
    const [countGroup, controlsGroup] = [...(row?.children ?? [])];
    const filterForm = region.querySelector("form");
    const newCampaign = within(region)
      .getAllByRole("link")
      .find(
        (link) =>
          link.getAttribute("href") === `/${locale}/admin/email-campaigns/new`
      );

    expect(row?.classList.contains("flex-wrap")).toBe(true);
    expect(
      countGroup?.contains(
        await within(region).findByLabelText(
          m.emailCampaignsListCount({ count: 0 }, { locale })
        )
      )
    ).toBe(true);
    expect(controlsGroup?.firstElementChild).toBe(filterForm);
    expect(newCampaign).toBeDefined();
    expect(filterForm?.contains(newCampaign ?? null)).toBe(false);
    expect(controlsGroup?.lastElementChild?.contains(newCampaign ?? null)).toBe(
      true
    );
  });
});
