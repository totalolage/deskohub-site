import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { AutomationFlow } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { AdministrationListParams } from "@/features/administration/list-href";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { automationFlowFixture } from "../activation/automation-detail.test-utils";
import { automationRunStatsFixture } from "./automation-run.test-utils";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render, within } = await import("@testing-library/react");
const { AutomationRunCounts } = await import("./automation-run-counts");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const zeroStates = { active: 0, sending: 0, ended: 0 };
const zeroOutcomes = {
  sent: 0,
  unconfirmed: 0,
  "condition-failed": 0,
  skipped: 0,
  failed: 0,
  withdrawn: 0,
  archived: 0,
};
const zeroSkipReasons = {
  "missing-from-dotypos": 0,
  "deleted-customer": 0,
  "missing-email": 0,
  "invalid-email": 0,
  "consent-withdrawn": 0,
  "outside-test-domain": 0,
};

type StepCounts = {
  readonly stepId: string;
  readonly byState?: Partial<typeof zeroStates>;
  readonly byOutcome?: Partial<typeof zeroOutcomes>;
};

const statsFixture = (
  overrides: {
    readonly byState?: Partial<typeof zeroStates>;
    readonly byOutcome?: Partial<typeof zeroOutcomes>;
    readonly bySteps?: readonly StepCounts[];
    readonly bySkipReason?: Partial<typeof zeroSkipReasons>;
  } = {}
) =>
  automationRunStatsFixture({
    byState: { ...zeroStates, ...overrides.byState },
    byOutcome: { ...zeroOutcomes, ...overrides.byOutcome },
    bySteps: (overrides.bySteps ?? []).map(
      ({ stepId, byState, byOutcome }) => ({
        stepId,
        byState: { ...zeroStates, ...byState },
        byOutcome: { ...zeroOutcomes, ...byOutcome },
      })
    ),
    bySkipReason: { ...zeroSkipReasons, ...overrides.bySkipReason },
  });

const href = (params: AdministrationListParams) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  return `/admin/email-campaigns/x/runs?${search.toString()}`;
};

const renderCounts = (
  stats: ReturnType<typeof automationRunStatsFixture>,
  flow: AutomationFlow | null = automationFlowFixture(),
  locale: Locale = "en-US"
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AutomationRunCounts
        flow={flow}
        href={href}
        locale={locale}
        scope="All versions"
        stats={stats}
      />
    </RouteLocaleProvider>
  );

const regionFor = (
  view: ReturnType<typeof renderCounts>,
  locale: Locale = "en-US"
) =>
  within(view.container).getByRole("region", {
    name: m.emailAutomationRunsCountsTitle({}, { locale }),
  });

const queryOf = (link: HTMLElement) =>
  new URL(link.getAttribute("href") ?? "/", "http://localhost").searchParams;

const linksFor = (region: HTMLElement, key: string, value: string) =>
  within(region)
    .getAllByRole("link")
    .filter((link) => queryOf(link).get(key) === value);

const linkFor = (region: HTMLElement, key: string, value: string) => {
  const link = linksFor(region, key, value)[0];
  if (link === undefined) throw new Error("Expected filtered link to render");
  return link;
};

const expectCount = (link: HTMLElement, count: number) => {
  expect(within(link).getByText(String(count), { exact: true })).toBeTruthy();
};

describe("AutomationRunCounts", () => {
  test("labels its region with the section heading", () => {
    const view = renderCounts(statsFixture());

    expect(regionFor(view)).toBeTruthy();
  });

  test("links skipped counts to their positive reason breakdowns", () => {
    const view = renderCounts(
      statsFixture({
        byOutcome: { skipped: 3 },
        bySkipReason: { "missing-email": 2, "consent-withdrawn": 1 },
      })
    );
    const region = regionFor(view);
    const skipped = linkFor(region, "outcome", "skipped");
    const reasonLinks = within(region)
      .getAllByRole("link")
      .filter((link) => queryOf(link).has("skipReason"));

    expectCount(skipped, 3);
    expect(reasonLinks).toHaveLength(2);
    expect(
      queryOf(linkFor(region, "skipReason", "missing-email")).get("outcome")
    ).toBe("skipped");
    expectCount(linkFor(region, "skipReason", "missing-email"), 2);
    expect(
      queryOf(linkFor(region, "skipReason", "consent-withdrawn")).get("outcome")
    ).toBe("skipped");
    expectCount(linkFor(region, "skipReason", "consent-withdrawn"), 1);
  });

  test("omits archived at zero and links it when positive", () => {
    const empty = renderCounts(statsFixture());
    expect(linksFor(regionFor(empty), "outcome", "archived")).toHaveLength(0);

    const populated = renderCounts(
      statsFixture({ byOutcome: { archived: 2 } })
    );
    const archived = linkFor(regionFor(populated), "outcome", "archived");
    expectCount(archived, 2);
  });

  test("counts waiting runs and links active steps and sending runs", () => {
    const view = renderCounts(
      statsFixture({
        byState: { active: 3, sending: 4 },
        bySteps: [
          { stepId: "check", byState: { active: 2 } },
          { stepId: "pause", byState: { active: 0 } },
          { stepId: "send", byState: { active: 1 } },
        ],
      })
    );
    const region = regionFor(view);
    const waiting = linkFor(region, "state", "active");
    const activeStepLinks = within(region)
      .getAllByRole("link")
      .filter(
        (link) =>
          queryOf(link).get("state") === "active" && queryOf(link).has("step")
      );

    // The tile counts what its link lists: waiting runs, not sending ones.
    expectCount(waiting, 3);
    expect(activeStepLinks).toHaveLength(2);
    expect(
      activeStepLinks.map((link) => queryOf(link).get("step")).sort()
    ).toEqual(["check", "send"]);
    expectCount(linkFor(region, "step", "check"), 2);
    expectCount(linkFor(region, "step", "send"), 1);
    expectCount(linkFor(region, "state", "sending"), 4);
  });

  test("omits a sending breakdown when there are no sending runs", () => {
    const view = renderCounts(
      statsFixture({
        byState: { active: 2 },
        bySteps: [{ stepId: "check", byState: { active: 2 } }],
      })
    );
    const region = regionFor(view);

    expectCount(linkFor(region, "state", "active"), 2);
    expect(linksFor(region, "state", "sending")).toHaveLength(0);
  });

  test("links condition failures to each step with a positive count", () => {
    const view = renderCounts(
      statsFixture({
        byOutcome: { "condition-failed": 3 },
        bySteps: [
          { stepId: "check", byOutcome: { "condition-failed": 1 } },
          { stepId: "pause", byOutcome: { "condition-failed": 0 } },
          { stepId: "send", byOutcome: { "condition-failed": 2 } },
        ],
      })
    );
    const region = regionFor(view);
    const conditionFailureSteps = within(region)
      .getAllByRole("link")
      .filter(
        (link) =>
          queryOf(link).get("outcome") === "condition-failed" &&
          queryOf(link).has("step")
      );

    expectCount(linkFor(region, "outcome", "condition-failed"), 3);
    expect(conditionFailureSteps).toHaveLength(2);
    expect(
      conditionFailureSteps.map((link) => queryOf(link).get("step")).sort()
    ).toEqual(["check", "send"]);
    expectCount(linkFor(region, "step", "check"), 1);
    expectCount(linkFor(region, "step", "send"), 2);
  });

  test("gives every visible outcome tile and waiting tile its filter", () => {
    const view = renderCounts(
      statsFixture({
        byState: { active: 2 },
        byOutcome: {
          sent: 1,
          "condition-failed": 1,
          failed: 1,
          skipped: 1,
          withdrawn: 1,
        },
      })
    );
    const region = regionFor(view);

    for (const outcome of [
      "sent",
      "condition-failed",
      "failed",
      "skipped",
      "withdrawn",
    ]) {
      expect(linksFor(region, "outcome", outcome)).toHaveLength(1);
    }
    expect(linksFor(region, "state", "active")).toHaveLength(1);
  });

  test("shows an unconfirmed line only when its count is positive", () => {
    const withoutUnconfirmed = renderCounts(
      statsFixture({ byOutcome: { sent: 2 } })
    );
    expect(
      linksFor(regionFor(withoutUnconfirmed), "outcome", "unconfirmed")
    ).toHaveLength(0);

    const withUnconfirmed = renderCounts(
      statsFixture({ byOutcome: { sent: 2, unconfirmed: 1 } })
    );
    const region = regionFor(withUnconfirmed);
    const sent = linkFor(region, "outcome", "sent");
    const unconfirmed = linkFor(region, "outcome", "unconfirmed");

    expectCount(sent, 2);
    expectCount(unconfirmed, 1);
    expect(sent.closest("li")?.contains(unconfirmed)).toBe(true);
  });

  test("renders counts when the flow is unavailable", () => {
    const view = renderCounts(
      statsFixture({
        byState: { active: 1 },
        bySteps: [{ stepId: "check", byState: { active: 1 } }],
      }),
      null
    );
    const region = regionFor(view);

    expectCount(linkFor(region, "state", "active"), 1);
    expectCount(linkFor(region, "step", "check"), 1);
  });
});
