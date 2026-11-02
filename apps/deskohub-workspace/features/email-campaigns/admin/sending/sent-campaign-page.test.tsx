import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  AdministrationCampaignSendId,
  type AdministrationCampaignSendStatusType,
  AdministrationDotyposCustomerId,
  type AudienceFilter,
} from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { formatCount } from "@/shared/utils/number";
import { campaignIdSchema } from "../../campaign-identifiers";
import { describeAudienceFilter } from "../audience-filter-summary";
import { captureCampaignOperations } from "../campaign-operation-actions.test-utils";
import type { OnceCampaignDetail } from "../campaign-page-data.server";

const locale = "en-US";
const campaignId = campaignIdSchema.make("synthetic-sent-campaign");
let sentCampaign: {
  send: AdministrationCampaignSendStatusType | null;
  audienceTitle: string | null;
};
const loadSentCampaign = mock(async () => sentCampaign);

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: async () => locale,
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale }),
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
  }),
}));
mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));
mock.module("../audiences/audience-value-lookups.server", () => ({
  loadAudienceValueLookups: async () => ({}),
}));
mock.module("./sent-campaign.server", () => ({ loadSentCampaign }));
mock.module("./sent-campaign-email.server", () => ({
  loadSentCampaignEmails: async () => [
    {
      locale: "cs-CZ",
      subject: "Podzimní novinky",
      preheader: "Co je nového",
      html: "<p>Ahoj</p>",
    },
  ],
}));

registerWorkspaceComponentTestEnv();

const { SentCampaignPage } = await import("./sent-campaign-page");

const campaignOf = (status: OnceCampaignDetail["status"]): OnceCampaignDetail =>
  ({
    id: campaignId,
    title: "Autumn newsletter",
    delivery: "once",
    status,
    purpose: "marketing",
  }) as OnceCampaignDetail;

const czechSpeakers: AudienceFilter = {
  _tag: "Condition",
  attribute: "locale",
  operator: "anyOf",
  value: ["cs-CZ"],
};
const visitedSinceJanuary: AudienceFilter = {
  _tag: "Condition",
  attribute: "lastVisit",
  operator: "in",
  value: { _tag: "Since", date: "2026-01-01" },
};

const counts = {
  pending: 0,
  sent: 1,
  delivered: 2,
  bounced: 0,
  complained: 0,
  failed: 1,
  unconfirmed: 0,
  skipped: 0,
};

const sendOf = (
  send: Partial<AdministrationCampaignSendStatusType>
): AdministrationCampaignSendStatusType => ({
  sendId: AdministrationCampaignSendId.make("send-1"),
  createdAt: "2026-10-03T08:00:00Z",
  completedAt: null,
  audienceId: null,
  audienceFilter: czechSpeakers,
  counts,
  recipients: [
    {
      customerId: AdministrationDotyposCustomerId.make("synthetic-101"),
      locale: "cs-CZ",
      status: "delivered",
      skipReason: null,
      statusUpdatedAt: "2026-10-03T08:05:00Z",
    },
  ],
  ...send,
});

const renderPage = async (status: OnceCampaignDetail["status"]) =>
  render(
    <RouteLocaleProvider locale={locale}>
      {await SentCampaignPage({ campaign: campaignOf(status) })}
    </RouteLocaleProvider>
  );

type PageView = Awaited<ReturnType<typeof renderPage>>;

/** Every fact on the page, label to value. */
const factsOf = (view: PageView) =>
  new Map(
    Array.from(
      view.container.querySelectorAll("dl > div"),
      (fact) =>
        [
          fact.querySelector("dt")?.textContent,
          fact.querySelector("dd")?.textContent,
        ] as const
    )
  );

const sectionTitles = (view: PageView) =>
  view
    .getAllByRole("heading", { level: 2 })
    .map(({ textContent }) => textContent);

const unconfirmedNote = m.emailCampaignsSentDeliveryUnconfirmedNote(
  {},
  { locale }
);

const operations = captureCampaignOperations();

describe("SentCampaignPage", () => {
  beforeEach(() => operations.install());
  afterEach(() => {
    cleanup();
    loadSentCampaign.mockClear();
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("a failed send shows its notice, retry, and delivery per status", async () => {
    sentCampaign = {
      send: sendOf({ counts: { ...counts, unconfirmed: 2 } }),
      audienceTitle: "Czech speakers",
    };
    const view = await renderPage("failed");
    const facts = factsOf(view);

    expect(loadSentCampaign).toHaveBeenCalledWith(campaignId);
    expect(
      view.getByText(m.emailCampaignsSentFailedNotice({}, { locale }))
    ).toBeTruthy();
    expect(
      view.getByRole("button", {
        name: m.emailCampaignsSentRetry({}, { locale }),
      })
    ).toBeTruthy();
    expect(facts.get(m.emailCampaignsSentSentAt({}, { locale }))).toBe(
      formatAdministrationDateTime("2026-10-03T08:00:00Z", locale)
    );
    expect(facts.get(m.emailCampaignsSentCompletedAt({}, { locale }))).toBe(
      m.emailCampaignsSentCompletedAtPending({}, { locale })
    );
    expect(facts.get(m.emailCampaignsSentAudience({}, { locale }))).toBe(
      "Czech speakers"
    );
    expect(facts.get(m.emailCampaignsSentAudienceFilter({}, { locale }))).toBe(
      m.emailCampaignsSentAudienceFilterSummary(
        { filter: describeAudienceFilter(czechSpeakers, locale) },
        { locale }
      )
    );
    expect(
      view.getByText(
        m.emailCampaignsSentDeliveryRecipientCount({ count: 1 }, { locale })
      )
    ).toBeTruthy();
    expect(view.getAllByText(formatCount(2, locale)).length).toBeGreaterThan(0);
    expect(view.getByText(unconfirmedNote)).toBeTruthy();
    expect(sectionTitles(view)).toContain(
      m.emailCampaignsSentRecipientsTitle({}, { locale })
    );
  });

  test("a send still under way without a recorded send shows what's missing", async () => {
    sentCampaign = { send: null, audienceTitle: null };
    const view = await renderPage("sending");
    const facts = factsOf(view);

    expect(
      view.getByText(m.emailCampaignsSentSendingNotice({}, { locale }))
    ).toBeTruthy();
    expect(
      view.queryByRole("button", {
        name: m.emailCampaignsSentRetry({}, { locale }),
      })
    ).toBeNull();
    expect(facts.get(m.emailCampaignsSentSentAt({}, { locale }))).toBe(
      m.emailCampaignsSentSentAtNotRecorded({}, { locale })
    );
    expect(facts.get(m.emailCampaignsSentCompletedAt({}, { locale }))).toBe(
      m.emailCampaignsSentCompletedAtPending({}, { locale })
    );
    expect(facts.has(m.emailCampaignsSentAudience({}, { locale }))).toBe(false);
    expect(
      view.getByText(m.emailCampaignsSentNoSendRecorded({}, { locale }))
    ).toBeTruthy();
    expect(sectionTitles(view)).not.toContain(
      m.emailCampaignsSentDeliveryTitle({}, { locale })
    );
    expect(sectionTitles(view)).not.toContain(
      m.emailCampaignsSentRecipientsTitle({}, { locale })
    );
  });

  test("a completed send to a deleted audience counts its filter back from the send", async () => {
    sentCampaign = {
      send: sendOf({
        completedAt: "2026-10-03T09:00:00Z",
        audienceFilter: visitedSinceJanuary,
      }),
      audienceTitle: null,
    };
    const view = await renderPage("sent");
    const facts = factsOf(view);

    expect(
      view.queryByText(m.emailCampaignsSentFailedNotice({}, { locale }))
    ).toBeNull();
    expect(
      view.queryByText(m.emailCampaignsSentSendingNotice({}, { locale }))
    ).toBeNull();
    expect(facts.get(m.emailCampaignsSentCompletedAt({}, { locale }))).toBe(
      formatAdministrationDateTime("2026-10-03T09:00:00Z", locale)
    );
    expect(facts.get(m.emailCampaignsSentAudience({}, { locale }))).toBe(
      m.emailCampaignsSentAudienceDeleted({}, { locale })
    );
    expect(facts.get(m.emailCampaignsSentAudienceFilter({}, { locale }))).toBe(
      m.emailCampaignsSentAudienceFilterCountedBack(
        {
          filter: describeAudienceFilter(visitedSinceJanuary, locale),
          sentAt: formatAdministrationDateTime("2026-10-03T08:00:00Z", locale),
        },
        { locale }
      )
    );
    expect(view.queryByText(unconfirmedNote)).toBeNull();
  });
});
