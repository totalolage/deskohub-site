import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
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
import { automationRunDetailFixture } from "./automation-run.test-utils";
import type { AutomationRunRecord } from "./automation-run-log.server";
import { automationStepLabelOrId } from "./automation-step-label";

const locale = "en-US";
const flow = automationFlowFixture();
let record: AutomationRunRecord;
const loadAutomationRun = mock(async () => record);

// The real request-locale module reads the route locale from next/root-params.
mock.module("next/root-params", () => ({ locale: async () => locale }));
const requestLocale = await import("@/features/i18n/server/request-locale");
mock.module("@/features/i18n/server/request-locale", () => ({
  ...requestLocale,
  getRequestLocale: async () => locale,
}));
const runLog = await import("./automation-run-log.server");
mock.module("./automation-run-log.server", () => ({
  ...runLog,
  loadAutomationRun,
}));

registerWorkspaceComponentTestEnv();

const { AutomationRunPage } = await import("./automation-run-page");

const automated: AutomatedCampaign = {
  campaign: { id: fixtureCampaignId } as AutomatedCampaign["campaign"],
  automation: automationDetailFixture(),
};
const runId = "run-1";

const recordOf = (
  run: Parameters<typeof automationRunDetailFixture>[0]
): AutomationRunRecord => ({
  run: automationRunDetailFixture(run),
  flow,
  conditionWording: { audiences: new Map(), lookups: {} },
});

const renderPage = async () =>
  render(
    <RouteLocaleProvider locale={locale}>
      {await AutomationRunPage({ automated, runId })}
    </RouteLocaleProvider>
  );

/** The run summary's facts, label to value, in document order. */
const factsOf = (view: Awaited<ReturnType<typeof renderPage>>) =>
  Array.from(
    view.container.querySelectorAll("dl > div"),
    (fact) =>
      [
        fact.querySelector("dt")?.textContent,
        fact.querySelector("dd")?.textContent,
      ] as const
  );

describe("AutomationRunPage", () => {
  afterEach(() => {
    cleanup();
    loadAutomationRun.mockClear();
  });
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("loads the route's run of this campaign and links back to its runs", async () => {
    record = recordOf({});
    const view = await renderPage();

    expect(loadAutomationRun).toHaveBeenCalledWith(fixtureCampaignId, runId);
    expect(
      view
        .getByRole("link", {
          name: m.emailAutomationRunsBackToList({}, { locale }),
        })
        .getAttribute("href")
    ).toBe(`/${locale}/admin/email-campaigns/${fixtureCampaignId}/runs`);
  });

  test("an ended run shows the step it ended at and when it ended", async () => {
    const endedAt = "2026-10-05T08:00:00.000Z";
    record = recordOf({ endedAt, stepId: "send" });
    const facts = new Map(factsOf(await renderPage()));

    expect(facts.get(m.emailAutomationRunsEndedAtStep({}, { locale }))).toBe(
      automationStepLabelOrId({ flow, stepId: "send", locale })
    );
    expect(facts.has(m.emailAutomationRunsCurrentStep({}, { locale }))).toBe(
      false
    );
    expect(facts.get(m.emailAutomationRunsColumnEnded({}, { locale }))).toBe(
      formatAdministrationDateTime(endedAt, locale)
    );
  });

  test("a run under way shows its current step and that it hasn't ended", async () => {
    record = recordOf({
      state: "active",
      phase: "ready",
      outcome: null,
      endedAt: null,
      stepId: "send",
    });
    const facts = new Map(factsOf(await renderPage()));

    expect(facts.get(m.emailAutomationRunsCurrentStep({}, { locale }))).toBe(
      automationStepLabelOrId({ flow, stepId: "send", locale })
    );
    expect(facts.has(m.emailAutomationRunsEndedAtStep({}, { locale }))).toBe(
      false
    );
    expect(facts.get(m.emailAutomationRunsColumnEnded({}, { locale }))).toBe(
      m.emailAutomationRunsNotEnded({}, { locale })
    );
  });

  test("the summary lists status, customer, trigger, version, step, start, and end", async () => {
    record = recordOf({});
    const labels = factsOf(await renderPage()).map(([label]) => label);

    expect(labels).toEqual([
      m.emailAutomationRunsColumnStatus({}, { locale }),
      m.emailAutomationRunsColumnCustomer({}, { locale }),
      m.emailAutomationRunsColumnTrigger({}, { locale }),
      m.emailAutomationRunsColumnVersion({}, { locale }),
      m.emailAutomationRunsEndedAtStep({}, { locale }),
      m.emailAutomationRunsColumnStarted({}, { locale }),
      m.emailAutomationRunsColumnEnded({}, { locale }),
    ]);
  });
});
