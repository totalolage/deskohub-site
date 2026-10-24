import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import type { AutomationRunTimelineEntry } from "@deskohub/workspace-admin-api";
import { cleanup, render, within } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { automationFlowFixture } from "../activation/automation-detail.test-utils";
import type { ConditionWording } from "./automation-condition-failures";
import { timelineEntryFixture } from "./automation-run.test-utils";
import { automationStepLabelOrId } from "./automation-step-label";

const { AutomationRunTimeline } = await import("./automation-run-timeline");

const flow = automationFlowFixture();
const wording: ConditionWording = {
  audiences: new Map([["regulars", "Regulars"]]),
  lookups: {},
};
const at = "2026-10-03T08:00:00.000Z";

const renderTimeline = (
  entries: readonly AutomationRunTimelineEntry[],
  locale: Locale = "en-US"
) => {
  const view = render(
    <AutomationRunTimeline
      conditionWording={wording}
      entries={entries}
      flow={flow}
      locale={locale}
    />
  );
  const timeline = view.getByRole("list", {
    name: m.emailAutomationRunsTimelineLabel({}, { locale }),
  });
  const items = Array.from(timeline.children) as HTMLElement[];
  return { timeline, items };
};

const entriesOf = (
  entries: readonly Parameters<typeof timelineEntryFixture>[0][]
) =>
  entries.map((entry, index) =>
    timelineEntryFixture({ sequence: index + 1, at, ...entry })
  );

describe("AutomationRunTimeline", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test.each(["en-US", "cs-CZ"] as const)(
    "titles and times each event kind from its own detail (%s)",
    (locale) => {
      const dueAt = "2026-10-05T08:00:00.000Z";
      const recheckAt = "2026-10-06T09:30:00.000Z";
      const date = (instant: string) =>
        formatAdministrationDateTime(instant, locale);
      const options = { locale };
      const cases = [
        [{ kind: "started" }, m.emailAutomationRunsEventStarted({}, options)],
        [
          { kind: "condition-passed", stepId: "check" },
          m.emailAutomationRunsEventConditionPassed({}, options),
        ],
        [
          {
            kind: "condition-failed",
            stepId: "check",
            detail: { failedConditions: [0] },
          },
          m.emailAutomationRunsEventConditionFailed({}, options),
        ],
        [
          { kind: "waiting", stepId: "pause", detail: { dueAt } },
          m.emailAutomationRunsEventWaiting({ date: date(dueAt) }, options),
        ],
        [
          { kind: "woke", stepId: "pause" },
          m.emailAutomationRunsEventWoke({}, options),
        ],
        [
          {
            kind: "deferred",
            stepId: "send",
            detail: { cause: "trigger-not-reached", recheckAt },
          },
          m.emailAutomationRunsEventDeferred(
            { date: date(recheckAt) },
            options
          ),
        ],
        [
          { kind: "send-queued", stepId: "send", detail: { sendId: "send-1" } },
          m.emailAutomationRunsEventSendQueued({}, options),
        ],
        [
          { kind: "sent", stepId: "send" },
          m.emailAutomationRunsEventSent({}, options),
        ],
        [
          { kind: "unconfirmed", stepId: "send" },
          m.emailAutomationRunsEventUnconfirmed({}, options),
        ],
        [
          {
            kind: "skipped",
            stepId: "send",
            detail: { reason: "missing-email" },
          },
          m.emailAutomationRunsOutcomeSkippedBecause(
            { reason: m.emailAutomationRunsSkipMissingEmail({}, options) },
            options
          ),
        ],
        [
          {
            kind: "failed",
            stepId: "send",
            detail: { reason: "delivery-refused" },
          },
          m.emailAutomationRunsOutcomeFailedBecause(
            {
              reason: m.emailAutomationRunsFailureDeliveryRefused({}, options),
            },
            options
          ),
        ],
        [
          { kind: "withdrawn" },
          m.emailAutomationRunsOutcomeWithdrawn({}, options),
        ],
        [
          { kind: "archived" },
          m.emailAutomationRunsOutcomeArchived({}, options),
        ],
      ] as const;
      const entries = entriesOf(cases.map(([entry]) => entry));
      const { items } = renderTimeline(entries, locale);

      expect(
        items.map(
          (item) => within(item).getByRole("heading", { level: 3 }).textContent
        )
      ).toEqual(cases.map(([, title]) => title));
      expect(
        items.map((item) =>
          item.querySelector("time")?.getAttribute("dateTime")
        )
      ).toEqual(entries.map((entry) => entry.at));
    }
  );

  test("names the step an entry happened at, and none without a step", () => {
    const { items } = renderTimeline(
      entriesOf([{ kind: "started" }, { kind: "woke", stepId: "pause" }])
    );
    const stepLabel = automationStepLabelOrId({
      flow,
      stepId: "pause",
      locale: "en-US",
    });

    expect(items[0]?.querySelector("p")).toBeNull();
    expect(within(items[1] as HTMLElement).getByText(stepLabel)).toBeDefined();
  });

  test("lists each failed clause of a condition", () => {
    const { items } = renderTimeline(
      entriesOf([
        {
          kind: "condition-failed",
          stepId: "check",
          detail: { failedConditions: [0, 3] },
        },
      ])
    );

    expect(
      within(items[0] as HTMLElement).getAllByRole("listitem")
    ).toHaveLength(2);
  });

  test("adds a detail line to unconfirmed, withdrawn and archived entries only", () => {
    const { items } = renderTimeline(
      entriesOf([
        { kind: "sent", stepId: "send" },
        { kind: "unconfirmed", stepId: "send" },
        { kind: "withdrawn" },
        { kind: "archived" },
      ])
    );

    expect(
      items.map((item) => within(item).queryAllByRole("listitem").length)
    ).toEqual([0, 1, 1, 1]);
  });

  test("shows an event kind it doesn't know by its raw kind", () => {
    const { items } = renderTimeline(
      entriesOf([{ kind: "teleported", stepId: "pause", detail: { to: "x" } }])
    );

    expect(
      within(items[0] as HTMLElement).getByRole("heading", { level: 3 })
        .textContent
    ).toBe(
      m.emailAutomationRunsEventUnknown(
        { kind: "teleported" },
        { locale: "en-US" }
      )
    );
  });

  test.each([
    { kind: "skipped", detail: { reason: "not-a-reason" } },
    { kind: "failed", detail: { reason: "not-a-reason" } },
    { kind: "condition-failed", detail: {} },
    { kind: "waiting", detail: {} },
    { kind: "deferred", detail: { cause: "trigger-not-reached" } },
  ])(
    "falls back to the generic entry for a $kind event it can't read",
    (entry) => {
      const { items } = renderTimeline(
        entriesOf([{ ...entry, stepId: "send" }])
      );

      expect(
        within(items[0] as HTMLElement).getByRole("heading", { level: 3 })
          .textContent
      ).toBe(
        m.emailAutomationRunsEventUnknown(
          { kind: entry.kind },
          { locale: "en-US" }
        )
      );
    }
  );
});
