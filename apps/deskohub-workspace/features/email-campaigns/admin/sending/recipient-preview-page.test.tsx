import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { AdministrationDotyposCustomerId } from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { formatCount } from "@/shared/utils/number";
import { campaignIdSchema } from "../../campaign-identifiers";
import type { RecipientPreview } from "./recipient-preview.server";

const locale = "en-US";
const campaignId = campaignIdSchema.make("synthetic-campaign");
let preview: RecipientPreview;
const loadRecipientPreview = mock(async () => preview);

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: async () => locale,
}));
mock.module("./recipient-preview.server", () => ({ loadRecipientPreview }));

registerWorkspaceComponentTestEnv();

const { RecipientPreviewPage } = await import("./recipient-preview-page");

const campaign = {
  id: campaignId,
  title: "Autumn newsletter",
} as RecipientPreview["campaign"];
const customerId = (id: string) => AdministrationDotyposCustomerId.make(id);
const email = (id: string) => testEmailAddress(`recipient-preview-page-${id}`);
const audience = {
  audienceTitle: "Regulars",
  audienceSummary: "Visited at least 3 times",
};
const audienceDescription = m.emailCampaignsRecipientPreviewAudienceDescription(
  { audience: audience.audienceTitle, filter: audience.audienceSummary },
  { locale }
);

const renderPage = async () =>
  render(
    <RouteLocaleProvider locale={locale}>
      {await RecipientPreviewPage({ campaignId })}
    </RouteLocaleProvider>
  );

const linkHref = (view: Awaited<ReturnType<typeof renderPage>>, name: string) =>
  view.getByRole("link", { name }).getAttribute("href");

/** The summary's facts, label to value, in document order. */
const factsOf = (view: Awaited<ReturnType<typeof renderPage>>) =>
  Array.from(
    view.container.querySelectorAll("dl > div"),
    (fact) =>
      [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ] as const
  );

describe("RecipientPreviewPage", () => {
  afterEach(() => {
    cleanup();
    loadRecipientPreview.mockClear();
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("loads the route's campaign and links back to it", async () => {
    preview = { kind: "no-audience", campaign };
    const view = await renderPage();

    expect(loadRecipientPreview).toHaveBeenCalledWith(campaignId);
    expect(view.getByText(campaign.title)).toBeTruthy();
    expect(
      linkHref(
        view,
        m.emailCampaignsRecipientPreviewBackToCampaign({}, { locale })
      )
    ).toBe(`/${locale}/admin/email-campaigns/${campaignId}`);
  });

  test("without an audience, warns and describes no audience", async () => {
    preview = { kind: "no-audience", campaign };
    const view = await renderPage();

    expect(
      view.getByText(m.emailCampaignsRecipientPreviewNoAudience({}, { locale }))
    ).toBeTruthy();
    expect(view.queryByText(audienceDescription)).toBeNull();
    expect(view.queryByRole("alert")).toBeNull();
    expect(factsOf(view)).toEqual([]);
  });

  test("when recipients can't be resolved, offers to try again", async () => {
    preview = { kind: "unavailable", campaign, ...audience };
    const view = await renderPage();

    expect(view.getByText(audienceDescription)).toBeTruthy();
    expect(view.getByRole("alert").textContent).toContain(
      m.emailCampaignsRecipientPreviewUnavailable({}, { locale })
    );
    expect(
      linkHref(view, m.emailCampaignsRecipientPreviewTryAgain({}, { locale }))
    ).toBe(`/${locale}/admin/email-campaigns/${campaignId}/recipients`);
    expect(factsOf(view)).toEqual([]);
  });

  test("a resolved audience counts recipients, exclusions, and shared emails", async () => {
    preview = {
      kind: "resolved",
      campaign,
      ...audience,
      resolution: {
        recipients: [
          {
            customerId: customerId("101"),
            locale: "cs-CZ",
            email: email("101"),
          },
          {
            customerId: customerId("102"),
            locale: "en-US",
            email: email("102"),
          },
        ],
        exclusions: [
          { customerId: customerId("103"), reason: "missing-email" },
        ],
        duplicates: [
          {
            email: email("101"),
            recipientCustomerId: customerId("101"),
            duplicateCustomerIds: [customerId("104")],
          },
        ],
      },
    };
    const view = await renderPage();

    expect(view.getByText(audienceDescription)).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.getAllByText(email("102")).length).toBeGreaterThan(0);
    expect(factsOf(view)).toEqual([
      [
        m.emailCampaignsRecipientPreviewRecipients({}, { locale }),
        formatCount(2, locale),
      ],
      [
        m.emailCampaignsRecipientPreviewExcluded({}, { locale }),
        formatCount(1, locale),
      ],
      [
        m.emailCampaignsRecipientPreviewSharedEmails({}, { locale }),
        formatCount(1, locale),
      ],
    ]);
  });
});
