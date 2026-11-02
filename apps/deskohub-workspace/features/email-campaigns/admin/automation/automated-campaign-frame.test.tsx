import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { AutomationDetail } from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  activeVersionFixture,
  automationDetailFixture,
  fixtureCampaignId,
} from "./activation/automation-detail.test-utils";
import type { AutomatedCampaign } from "./automated-campaign.server";

const locale = "en-US";

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: async () => locale,
}));
mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();

const { AutomatedCampaignFrame } = await import("./automated-campaign-frame");

const title = "Synthetic welcome series";

const renderFrame = async (
  automation: AutomationDetail,
  section: "flow" | "email" | "preview" | "runs" = "flow"
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      {
        await AutomatedCampaignFrame({
          automated: {
            campaign: {
              id: fixtureCampaignId,
              title,
            } as AutomatedCampaign["campaign"],
            automation,
          },
          section,
          children: <p data-testid="section-content" />,
        })
      }
    </RouteLocaleProvider>
  );

const sectionLinks = (view: Awaited<ReturnType<typeof renderFrame>>) =>
  Array.from(
    view
      .getByRole("navigation", {
        name: m.emailAutomationsSectionsLabel({}, { locale }),
      })
      .querySelectorAll("a")
  );

describe("AutomatedCampaignFrame", () => {
  beforeEach(() => {
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation(
      () => ({ execute: mock(), isExecuting: false }) as never
    );
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("links every section of the campaign and marks the current one", async () => {
    const view = await renderFrame(automationDetailFixture(), "preview");
    const links = sectionLinks(view);

    expect(
      links.map((link) => new URL(link.href, "https://deskohub.test").pathname)
    ).toEqual([
      `/${locale}/admin/email-campaigns/${fixtureCampaignId}`,
      `/${locale}/admin/email-campaigns/${fixtureCampaignId}/email`,
      `/${locale}/admin/email-campaigns/${fixtureCampaignId}/preview`,
      `/${locale}/admin/email-campaigns/${fixtureCampaignId}/runs`,
    ]);
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
      null,
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      m.emailAutomationsSectionFlow({}, { locale }),
      m.emailAutomationsSectionEmail({}, { locale }),
      m.emailAutomationsSectionPreview({}, { locale }),
      m.emailAutomationsSectionRuns({}, { locale }),
    ]);
  });

  test("titles the page and renders the section below the tabs", async () => {
    const view = await renderFrame(automationDetailFixture());

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(title);
    const content = view.getByTestId("section-content");
    expect(
      view.getByRole("navigation").compareDocumentPosition(content) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  test("says a draft was never activated and has no pending changes", async () => {
    const view = await renderFrame(automationDetailFixture());

    expect(
      view.queryByText(m.emailAutomationsNeverActivated({}, { locale }))
    ).not.toBeNull();
    expect(
      view.queryByText(m.emailAutomationsPendingChanges({}, { locale }))
    ).toBeNull();
  });

  test("names the live version and flags its pending changes", async () => {
    const version = activeVersionFixture(2);
    const view = await renderFrame(
      automationDetailFixture({
        status: "active",
        activeVersion: version,
        versionCount: 2,
        pendingChanges: true,
      })
    );

    expect(
      view.queryByText(
        m.emailAutomationsVersionLive(
          {
            version: 2,
            date: formatAdministrationDateTime(version.activatedAt, locale),
          },
          { locale }
        )
      )
    ).not.toBeNull();
    expect(
      view.queryByText(m.emailAutomationsPendingChanges({}, { locale }))
    ).not.toBeNull();
    expect(
      view.queryByText(m.emailAutomationsNeverActivated({}, { locale }))
    ).toBeNull();
  });
});
