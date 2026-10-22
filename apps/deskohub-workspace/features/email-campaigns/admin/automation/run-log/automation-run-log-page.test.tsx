import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { AdministrationCampaignRecipientSkipReason } from "@deskohub/workspace-admin-api";
import { cleanup, render } from "@testing-library/react";
import { Result } from "effect";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  automationDetailFixture,
  automationFlowFixture,
  fixtureCampaignId,
} from "../activation/automation-detail.test-utils";
import type { AutomatedCampaign } from "../automated-campaign.server";
import {
  automationEngineHealthFixture,
  automationRunFixture,
  automationRunStatsFixture,
} from "./automation-run.test-utils";
import {
  type AutomationRunSearchParams,
  parseAutomationRunFilters,
} from "./automation-run-filters";
import type { AutomationRunLog } from "./automation-run-log.server";

const locale = "en-US";
const flow = automationFlowFixture();
let log: AutomationRunLog;
const loadAutomationRunLog = mock(async () => log);

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: async () => locale,
}));
mock.module("./automation-run-log.server", () => ({ loadAutomationRunLog }));

registerWorkspaceComponentTestEnv();

const { AutomationRunLogPage } = await import("./automation-run-log-page");

const automated: AutomatedCampaign = {
  campaign: { id: fixtureCampaignId } as AutomatedCampaign["campaign"],
  automation: automationDetailFixture(),
};
const firstPageLabel = m.emailAutomationRunsFirstPage({}, { locale });
const contactsUnavailableLabel =
  m.emailAutomationRunsCustomerContactsUnavailable({}, { locale });
const runsPath = `/${locale}/admin/email-campaigns/${fixtureCampaignId}/runs`;

const loadedLog = (
  overrides: Partial<AutomationRunLog> = {}
): AutomationRunLog => ({
  summary: Result.succeed({
    stats: automationRunStatsFixture({
      byOutcome: { sent: 2, failed: 1, skipped: 1 },
      bySkipReason: { "missing-email": 1 },
    }),
    versions: [],
  }),
  runs: Result.succeed({
    runs: [automationRunFixture()],
    nextCursor: "cursor-next",
  }),
  health: Result.succeed(automationEngineHealthFixture()),
  checkedAt: Date.parse("2026-10-05T08:00:00Z"),
  flows: new Map([[1, flow]]),
  flow,
  ...overrides,
});

const renderPage = async (searchParams: AutomationRunSearchParams = {}) =>
  render(
    <RouteLocaleProvider locale={locale}>
      {await AutomationRunLogPage({ automated, searchParams })}
    </RouteLocaleProvider>
  );

/** The query of every link to the run list, in document order. */
const listLinks = (view: Awaited<ReturnType<typeof renderPage>>) =>
  view
    .getAllByRole("link")
    .map((link) => new URL(link.getAttribute("href") ?? "", "http://admin"))
    .filter((url) => url.pathname === runsPath)
    .map((url) => Object.fromEntries(url.searchParams));

const countsRegion = (view: Awaited<ReturnType<typeof renderPage>>) =>
  view.container.querySelector(
    "section[aria-labelledby='automation-run-counts']"
  );

describe("AutomationRunLogPage", () => {
  beforeEach(() => {
    log = loadedLog();
    loadAutomationRunLog.mockClear();
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("loads the runs the URL's filters select", async () => {
    const searchParams = { outcome: "skipped", skipReason: "missing-email" };
    await renderPage(searchParams);

    expect(loadAutomationRunLog).toHaveBeenCalledWith(
      automated,
      parseAutomationRunFilters(searchParams)
    );
  });

  test("count links keep only the version, the pages keep every filter", async () => {
    const view = await renderPage({
      version: "1",
      outcome: "skipped",
      skipReason: "missing-email",
      step: "send",
    });
    const links = listLinks(view);

    const failedTile = links.find((params) => params.outcome === "failed");
    expect(failedTile).toEqual({ version: "1", outcome: "failed" });
    expect(links.find((params) => params.cursor === "cursor-next")).toEqual({
      version: "1",
      outcome: "skipped",
      skipReason: "missing-email",
      step: "send",
      cursor: "cursor-next",
    });
  });

  test("a submitted filter form reads back as the same filters", async () => {
    const searchParams = {
      state: "ended",
      outcome: "skipped",
      skipReason: "consent-withdrawn",
      step: "pause",
      customer: "dotypos-customer-9",
    };
    const view = await renderPage(searchParams);
    const form = view.container.querySelector("form");
    if (form === null) throw new Error("no filter form");

    const submitted = Object.fromEntries(
      Array.from(new FormData(form)).map(([name, value]) => [
        name,
        String(value),
      ])
    );

    expect(parseAutomationRunFilters(submitted)).toEqual(
      parseAutomationRunFilters(searchParams)
    );
  });

  test("filters by every skip reason the port knows, and by the flow's steps", async () => {
    const view = await renderPage();
    const optionValues = (id: string) =>
      Array.from(
        view.container.querySelectorAll<HTMLOptionElement>(`#${id} option`),
        (option) => option.value
      );

    expect(optionValues("automation-run-skip-reason")).toEqual([
      "",
      ...AdministrationCampaignRecipientSkipReason.literals,
    ]);
    expect(optionValues("automation-run-step")).toEqual([
      "",
      ...flow.steps.map(({ id }) => id),
    ]);
  });

  test("lists the runs when the counts fail to load", async () => {
    log = loadedLog({ summary: Result.fail({ code: "unavailable" }) });
    const view = await renderPage();

    expect(countsRegion(view)).toBeNull();
    expect(view.container.querySelector("form")).not.toBeNull();
  });

  test("shows the counts when the runs fail to load, with a way back to the first page", async () => {
    log = loadedLog({
      runs: Result.fail({ code: "automation-page-cursor-invalid" }),
    });
    const view = await renderPage({ outcome: "sent", cursor: "stale" });
    const firstPage = view.getByRole("link", { name: firstPageLabel });

    expect(countsRegion(view)).not.toBeNull();
    expect(view.container.querySelector("form")).toBeNull();
    expect(firstPage.getAttribute("href")).toBe(`${runsPath}?outcome=sent`);
  });

  test("offers no first page link when the first page itself fails", async () => {
    log = loadedLog({ runs: Result.fail({ code: "unavailable" }) });
    const view = await renderPage({ outcome: "sent" });

    expect(view.queryByRole("link", { name: firstPageLabel })).toBeNull();
  });

  test("warns when Dotypos couldn't be read for some customer", async () => {
    const warns = async (statuses: readonly ("found" | "unavailable")[]) => {
      log = loadedLog({
        runs: Result.succeed({
          runs: statuses.map((customerProfileStatus, index) =>
            automationRunFixture({
              runId: `run-${index}`,
              customerProfileStatus,
            })
          ),
          nextCursor: null,
        }),
      });
      const view = await renderPage();
      const shown = view.queryAllByText(contactsUnavailableLabel).length;
      cleanup();
      return shown;
    };

    expect(await warns(["found", "found"])).toBe(0);
    expect(await warns(["found", "unavailable", "unavailable"])).toBe(1);
  });
});
