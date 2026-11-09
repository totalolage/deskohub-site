import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
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

async function prerenderCampaignListPage() {
  const { CampaignListPage } = await import("./campaign-list-page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={locale}>
      <CampaignListPage
        campaigns={Promise.resolve([])}
        delivery={Promise.resolve(undefined)}
      />
    </RouteLocaleProvider>,
    // Inline every completed boundary instead of streaming hidden segments.
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

describe("CampaignListPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps the delivery filter and the new-campaign action on the count's row", async () => {
    const view = await prerenderCampaignListPage();
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
        within(region).getByLabelText(
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
