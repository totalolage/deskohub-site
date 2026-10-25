import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { AutomationEngineHealth } from "@deskohub/workspace-admin-api";
import { Result } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { fixtureCampaignId } from "../activation/automation-detail.test-utils";
import { automationEngineHealthFixture } from "./automation-run.test-utils";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render, within } = await import("@testing-library/react");
const { AutomationEngineHealthIndicator } = await import(
  "./automation-engine-health"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const checkedAt = Date.parse("2026-10-05T08:00:00Z");

const renderHealth = (
  health: Result.Result<AutomationEngineHealth, { readonly code: string }>,
  locale: Locale = "en-US"
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AutomationEngineHealthIndicator
        campaignId={fixtureCampaignId}
        checkedAt={checkedAt}
        health={health}
        locale={locale}
      />
    </RouteLocaleProvider>
  );

const renderReport = (
  report: AutomationEngineHealth,
  locale: Locale = "en-US"
) => renderHealth(Result.succeed(report), locale);
const listItems = (view: ReturnType<typeof renderHealth>) =>
  within(view.container).queryAllByRole("listitem");

describe("AutomationEngineHealthIndicator", () => {
  test.each(["en-US", "cs-CZ"] as const)(
    "shows only the unavailable line after a failed read in %s",
    (locale) => {
      const view = renderHealth(
        Result.fail({ code: "health-unavailable" }),
        locale
      );
      const unavailable = m.emailAutomationRunsHealthUnavailable(
        {},
        { locale }
      );

      expect(view.container.textContent).toBe(unavailable);
      expect(listItems(view)).toHaveLength(0);
      expect(view.container.querySelector("ul")).toBeNull();
    }
  );

  test("shows no alert for a healthy report without this campaign", () => {
    const view = renderReport(automationEngineHealthFixture());

    expect(listItems(view)).toHaveLength(0);
    expect(view.container.querySelector("ul")).toBeNull();
  });

  test("renders one list item per engine warning", () => {
    const view = renderReport(
      automationEngineHealthFixture({
        warnings: ["planner-stale", "sweep-lagging", "event-backlog"],
      })
    );

    expect(listItems(view)).toHaveLength(3);
  });

  test("uses the never-ran line when the planner timestamp is absent", () => {
    const view = renderReport(
      automationEngineHealthFixture({
        lastPlannedAt: null,
        warnings: ["planner-stale"],
      })
    );
    const neverRan = m.emailAutomationRunsHealthPlannerNeverRan(
      {},
      {
        locale: "en-US",
      }
    );

    expect(listItems(view)).toHaveLength(1);
    expect(within(view.container).getByText(neverRan).textContent).toBe(
      neverRan
    );
  });

  test("ignores health details for another campaign", () => {
    const view = renderReport(
      automationEngineHealthFixture({
        automations: [
          {
            campaignId: "synthetic-other-automation",
            scheduleLagSeconds: 90,
            enteringFire: {
              fireAt: "2026-10-05T08:00:00.000Z",
              chunksDone: 1,
              chunksTotal: 2,
            },
            lastFire: {
              fireAt: "2026-10-05T07:00:00.000Z",
              durationSeconds: 120,
              intervalSeconds: 60,
              fallingBehind: true,
            },
          },
        ],
      })
    );

    expect(listItems(view)).toHaveLength(0);
    expect(view.container.querySelector("ul")).toBeNull();
  });

  test("shows the entering-fire line for this campaign without engine warnings", () => {
    const view = renderReport(
      automationEngineHealthFixture({
        automations: [
          {
            campaignId: fixtureCampaignId,
            scheduleLagSeconds: null,
            enteringFire: {
              fireAt: "2026-10-05T08:00:00.000Z",
              chunksDone: 1,
              chunksTotal: 2,
            },
            lastFire: null,
          },
        ],
      })
    );

    expect(listItems(view)).toHaveLength(1);
  });

  test("adds campaign schedule lag only with a schedule-lagging warning", () => {
    const automation = {
      campaignId: fixtureCampaignId,
      scheduleLagSeconds: 180,
      enteringFire: null,
      lastFire: null,
    };
    const withoutWarning = renderReport(
      automationEngineHealthFixture({ automations: [automation] })
    );
    const locale = "en-US";
    const scheduleLag = m.emailAutomationRunsHealthCampaignScheduleLag(
      {
        duration: m.emailAutomationRunsDurationMinutes(
          { count: 3 },
          { locale }
        ),
      },
      { locale }
    );

    expect(
      within(withoutWarning.container).queryByText(scheduleLag)
    ).toBeNull();
    expect(withoutWarning.container.querySelector("ul")).toBeNull();

    const withWarning = renderReport(
      automationEngineHealthFixture({
        warnings: ["schedule-lagging"],
        automations: [automation],
      })
    );

    expect(listItems(withWarning)).toHaveLength(2);
    expect(
      within(withWarning.container).getByText(scheduleLag).textContent
    ).toBe(scheduleLag);
  });

  test("adds a falling-behind line only when the campaign fire is behind", () => {
    const lastFire = {
      fireAt: "2026-10-05T07:00:00.000Z",
      durationSeconds: 120,
      intervalSeconds: 60,
      fallingBehind: false,
    };
    const onSchedule = renderReport(
      automationEngineHealthFixture({
        automations: [
          {
            campaignId: fixtureCampaignId,
            scheduleLagSeconds: null,
            enteringFire: null,
            lastFire,
          },
        ],
      })
    );

    expect(listItems(onSchedule)).toHaveLength(0);
    expect(onSchedule.container.querySelector("ul")).toBeNull();

    const behind = renderReport(
      automationEngineHealthFixture({
        automations: [
          {
            campaignId: fixtureCampaignId,
            scheduleLagSeconds: null,
            enteringFire: null,
            lastFire: { ...lastFire, fallingBehind: true },
          },
        ],
      })
    );
    const fallingBehind = m.emailAutomationRunsHealthCampaignFallingBehind(
      {
        duration: m.emailAutomationRunsDurationMinutes(
          { count: 2 },
          { locale: "en-US" }
        ),
        interval: m.emailAutomationRunsDurationMinutes(
          { count: 1 },
          { locale: "en-US" }
        ),
      },
      { locale: "en-US" }
    );

    expect(listItems(behind)).toHaveLength(1);
    expect(within(behind.container).getByText(fallingBehind).textContent).toBe(
      fallingBehind
    );
  });

  const locale = "en-US";
  const at = "2026-10-05T06:30:00.000Z";
  test.each([
    {
      report: { warnings: ["planner-stale"], lastPlannedAt: null },
      line: m.emailAutomationRunsHealthPlannerNeverRan({}, { locale }),
    },
    {
      report: {
        warnings: ["planner-stale"],
        lastPlannedAt: "2026-10-05T07:56:00.000Z",
      },
      line: m.emailAutomationRunsHealthPlannerStale(
        { age: m.emailAutomationRunsAgeMinutes({ count: 4 }, { locale }) },
        { locale }
      ),
    },
    {
      report: { warnings: ["sweep-lagging"], sweepLagSeconds: null },
      line: m.emailAutomationRunsHealthSweepLaggingUnknown({}, { locale }),
    },
    {
      report: { warnings: ["sweep-lagging"], sweepLagSeconds: 720 },
      line: m.emailAutomationRunsHealthSweepLagging(
        {
          duration: m.emailAutomationRunsDurationMinutes(
            { count: 12 },
            { locale }
          ),
        },
        { locale }
      ),
    },
    {
      report: { warnings: ["reconcile-stalled"], reconcileLagSeconds: null },
      line: m.emailAutomationRunsHealthReconcileStalledUnknown({}, { locale }),
    },
    {
      report: { warnings: ["reconcile-stalled"], reconcileLagSeconds: 8400 },
      line: m.emailAutomationRunsHealthReconcileStalled(
        {
          duration: m.emailAutomationRunsDurationHours(
            { count: 2 },
            { locale }
          ),
        },
        { locale }
      ),
    },
    {
      // A code from a later server than this build.
      report: { warnings: ["synthetic-later-warning"] },
      line: m.emailAutomationRunsHealthUnrecognized(
        { code: "synthetic-later-warning" },
        { locale }
      ),
    },
    {
      report: { warnings: ["event-backlog"], oldestUnprocessedEventAt: null },
      line: m.emailAutomationRunsHealthEventBacklogUnknown({}, { locale }),
    },
    {
      report: { warnings: ["event-backlog"], oldestUnprocessedEventAt: at },
      line: m.emailAutomationRunsHealthEventBacklog(
        { date: formatAdministrationDateTime(at, locale) },
        { locale }
      ),
    },
    {
      report: { warnings: ["unit-backlog"], oldestPlannedUnitAt: null },
      line: m.emailAutomationRunsHealthUnitBacklogUnknown({}, { locale }),
    },
    {
      report: { warnings: ["unit-backlog"], oldestPlannedUnitAt: at },
      line: m.emailAutomationRunsHealthUnitBacklog(
        { date: formatAdministrationDateTime(at, locale) },
        { locale }
      ),
    },
    {
      report: { warnings: ["schedule-lagging"] },
      line: m.emailAutomationRunsHealthScheduleLagging({}, { locale }),
    },
    {
      report: { warnings: ["falling-behind"] },
      line: m.emailAutomationRunsHealthFallingBehind({}, { locale }),
    },
  ] as const)(
    "words the $report.warnings.0 warning from its own figures",
    ({ report, line }) => {
      const view = renderReport(automationEngineHealthFixture(report));

      expect(listItems(view).map((item) => item.textContent)).toEqual([line]);
    }
  );
});
