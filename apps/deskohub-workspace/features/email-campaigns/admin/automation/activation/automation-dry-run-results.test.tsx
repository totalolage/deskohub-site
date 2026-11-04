import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  AdministrationCampaignContent,
  AutomationDryRun,
  AutomationDryRunRow,
} from "@deskohub/workspace-admin-api";
import { automationPreviewOutcomes } from "@deskohub/workspace-admin-api";
import { cleanup, render, within } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { formatCount } from "@/shared/utils/number";
import { automationStepLabelOrId } from "../run-log/automation-step-label";
import {
  automationFlowFixture,
  fixtureCampaignId,
} from "./automation-detail.test-utils";
import { automationDryRunFixture } from "./automation-dry-run.test-utils";
import { AutomationDryRunResults } from "./automation-dry-run-results";

registerWorkspaceComponentTestEnv();

const locale = "en-US";
const flow = automationFlowFixture();
const named = testEmailAddress("dry-run-named");
const unnamed = testEmailAddress("dry-run-unnamed");
const asOf = "2026-10-05T08:00:00.000Z";

const renderResults = (
  dryRun: AutomationDryRun,
  {
    content = {},
    cursor,
  }: {
    readonly content?: AdministrationCampaignContent;
    readonly cursor?: string;
  } = {}
) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AutomationDryRunResults
        content={content}
        cursor={cursor}
        dryRun={dryRun}
        flow={flow}
        locale={locale}
      />
    </RouteLocaleProvider>
  );

const rowsLabel = m.emailAutomationActivationRowsLabel({}, { locale });
const date = (instant: string) => formatAdministrationDateTime(instant, locale);
const row = (
  overrides: Partial<typeof AutomationDryRunRow.Encoded> = {}
): typeof AutomationDryRunRow.Encoded => ({
  triggerAt: "2026-10-01T08:00:00.000Z",
  customerId: "customer-named",
  customerEventId: "event-1",
  outcome: "would-send",
  stepId: null,
  sendAt: null,
  ...overrides,
});
const customers = [
  { customerId: "customer-named", name: "Ada Synthetic", email: named },
  { customerId: "customer-unnamed", name: null, email: unnamed },
];

describe("AutomationDryRunResults", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("counts every outcome", () => {
    const counts = {
      "would-send": 1200,
      "condition-failed": 2,
      "not-in-audience": 3,
      "already-active": 4,
      withdrawn: 5,
      unavailable: 6,
    };
    const view = renderResults(automationDryRunFixture({ counts }));
    const facts = view.container.querySelectorAll("dl > div");

    expect(
      [...facts].map((fact) => fact.querySelector("dd")?.textContent)
    ).toEqual(
      automationPreviewOutcomes.map((outcome) =>
        formatCount(counts[outcome], locale)
      )
    );
  });

  test("dates a replay's window and says it read current profiles", () => {
    const view = renderResults(automationDryRunFixture({ asOf }));

    expect(
      view.getByText(
        m.emailAutomationActivationReplayScope({ asOf: date(asOf) }, { locale })
      )
    ).not.toBeNull();
    expect(
      view.queryByText(
        m.emailAutomationActivationProfileFactsCurrent({}, { locale })
      )
    ).not.toBeNull();
    expect(
      view.getByRole("heading", {
        name: m.emailAutomationActivationReplayRowsTitle({}, { locale }),
      })
    ).not.toBeNull();
    expect(
      view.queryByText(
        m.emailAutomationActivationNextFiresTitle({}, { locale })
      )
    ).toBeNull();
  });

  test("leaves out the current-profile note when the replay read past facts", () => {
    const view = renderResults(
      automationDryRunFixture({ profileFactsAreCurrent: false })
    );

    expect(
      view.queryByText(
        m.emailAutomationActivationProfileFactsCurrent({}, { locale })
      )
    ).toBeNull();
  });

  test("lists a schedule's next fires and who the first would enter", () => {
    const fires = ["2026-10-06T08:00:00.000Z", "2026-10-07T08:00:00.000Z"];
    const view = renderResults(
      automationDryRunFixture({ kind: "schedule", asOf, nextFires: fires })
    );
    const firesList = view.getByText(
      m.emailAutomationActivationNextFiresTitle({}, { locale })
    ).nextElementSibling as HTMLElement;

    expect(
      within(firesList)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(fires.map(date));
    expect(
      view.getByRole("heading", {
        name: m.emailAutomationActivationEntrantsTitle(
          { fire: date(asOf) },
          { locale }
        ),
      })
    ).not.toBeNull();
    expect(view.queryByRole("note")).toBeNull();
  });

  test("warns about a schedule that fires more than hourly", () => {
    const view = renderResults(
      automationDryRunFixture({
        kind: "schedule",
        frequency: { maxFiresPerHour: 4, firesMoreThanHourly: true },
      })
    );

    expect(view.getByRole("note")).not.toBeNull();
  });

  test("says how many events a truncated replay skipped, when it knows", () => {
    const truncated = m.emailAutomationActivationTruncated(
      { total: formatCount(1500, locale) },
      { locale }
    );
    expect(
      renderResults(
        automationDryRunFixture({ truncated: true, eventsTotal: 1500 })
      ).queryByText(truncated)
    ).not.toBeNull();
    cleanup();

    const view = renderResults(
      automationDryRunFixture({ truncated: true, eventsTotal: null })
    );
    expect(view.container.textContent).not.toContain(formatCount(1500, locale));
  });

  test.each([
    [
      "past the last page",
      "replay",
      "cursor-2",
      m.emailAutomationActivationNoMoreRows,
    ],
    [
      "without events",
      "replay",
      undefined,
      m.emailAutomationActivationNoReplayRows,
    ],
    [
      "without entrants",
      "schedule",
      undefined,
      m.emailAutomationActivationNoEntrants,
    ],
  ] as const)("says why a page has no rows: %s", (_, kind, cursor, label) => {
    const view = renderResults(automationDryRunFixture({ kind }), { cursor });

    expect(view.getByText(label({}, { locale }))).not.toBeNull();
    expect(view.queryByRole("list", { name: rowsLabel })).toBeNull();
  });

  test("names each row's customer by name, else email, else id", () => {
    const view = renderResults(
      automationDryRunFixture({
        customers,
        rows: [
          row(),
          row({ customerId: "customer-unnamed", customerEventId: null }),
          row({ customerId: "customer-unknown" }),
        ],
      })
    );
    const cells = within(view.getByRole("list", { name: rowsLabel }))
      .getAllByRole("listitem")
      .map((item) => [...item.querySelectorAll("p.truncate")])
      .map((lines) => lines.map((line) => line.textContent));

    expect(cells).toEqual([
      ["Ada Synthetic", named],
      [unnamed],
      ["customer-unknown"],
    ]);
  });

  test("shows a replayed row's trigger and every row's send time", () => {
    const sendAt = "2026-10-01T08:15:00.000Z";
    const view = renderResults(
      automationDryRunFixture({
        customers,
        rows: [row({ sendAt }), row({ customerEventId: "event-2" })],
      })
    );
    const [sending, held] = within(
      view.getByRole("list", { name: rowsLabel })
    ).getAllByRole("listitem");
    const tableRows = within(view.getByRole("table", { name: rowsLabel }))
      .getAllByRole("row")
      .map((tableRow) =>
        within(tableRow)
          .queryAllByRole("cell")
          .map((cell) => cell.textContent)
      );
    const outcome = m.emailAutomationActivationOutcomeWouldSend({}, { locale });

    expect(sending?.textContent).toContain(
      m.emailAutomationActivationRowSendAt({ date: date(sendAt) }, { locale })
    );
    expect(held?.textContent).toContain(
      m.emailAutomationActivationRowTriggered(
        { date: date("2026-10-01T08:00:00.000Z") },
        { locale }
      )
    );
    expect(held?.textContent).not.toContain(
      m.emailAutomationActivationRowSendAt({ date: date(sendAt) }, { locale })
    );
    expect(tableRows.slice(1)).toEqual([
      [
        date("2026-10-01T08:00:00.000Z"),
        `Ada Synthetic${named}`,
        outcome,
        date(sendAt),
      ],
      [date("2026-10-01T08:00:00.000Z"), `Ada Synthetic${named}`, outcome, "—"],
    ]);
  });

  test("leaves out the trigger time for a schedule's entrants", () => {
    const view = renderResults(
      automationDryRunFixture({
        kind: "schedule",
        customers,
        rows: [row({ customerEventId: null })],
      })
    );
    const table = view.getByRole("table", { name: rowsLabel });

    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    expect(
      within(view.getByRole("list", { name: rowsLabel })).getByRole("listitem")
        .textContent
    ).not.toContain(date("2026-10-01T08:00:00.000Z"));
  });

  test("names the step a row stopped at, and flags estimated rows", () => {
    const view = renderResults(
      automationDryRunFixture({
        customers,
        rows: [
          row({ outcome: "condition-failed", stepId: "check" }),
          row({
            customerEventId: "event-2",
            stepId: "send",
            projected: true,
            reservationStatusesApproximate: true,
          }),
        ],
      })
    );
    const [stopped, sending] = within(
      view.getByRole("list", { name: rowsLabel })
    ).getAllByRole("listitem");
    const stepLabel = (stepId: string) =>
      automationStepLabelOrId({ flow, stepId, locale });

    expect(stopped?.textContent).toContain(
      m.emailAutomationActivationOutcomeConditionFailed({}, { locale })
    );
    expect(stopped?.textContent).toContain(stepLabel("check"));
    expect(
      stopped?.textContent?.includes(
        m.emailAutomationActivationFlagProjected({}, { locale })
      )
    ).toBe(false);
    expect(sending?.textContent).not.toContain(stepLabel("send"));
    expect(sending?.textContent).toContain(
      m.emailAutomationActivationFlagProjected({}, { locale })
    );
    expect(sending?.textContent).toContain(
      m.emailAutomationActivationFlagApproximate({}, { locale })
    );
  });

  test("links no pages when the dry run fits one", () => {
    const view = renderResults(automationDryRunFixture());

    expect(view.queryByRole("navigation")).toBeNull();
  });

  test("links the next page, then back to the first", () => {
    const previewHref = `/${locale}/admin/email-campaigns/${fixtureCampaignId}/preview?preview=preview-1`;
    const first = renderResults(
      automationDryRunFixture({ nextCursor: "cursor-2" })
    );
    const firstNav = first.getByRole("navigation");
    expect(
      [...firstNav.querySelectorAll("a")].map((link) =>
        link.getAttribute("href")
      )
    ).toEqual([`${previewHref}&cursor=cursor-2`]);
    cleanup();

    const last = renderResults(automationDryRunFixture(), {
      cursor: "cursor-2",
    });
    expect(
      [...last.getByRole("navigation").querySelectorAll("a")].map((link) =>
        link.getAttribute("href")
      )
    ).toEqual([previewHref]);
  });

  test("previews the email with each locale's preheader", () => {
    const email = {
      subject: "Synthetic subject",
      html: "<p>Hi</p>",
      text: "Hi",
    };
    const withPreheader = renderResults(
      automationDryRunFixture({ emails: [{ locale: "cs-CZ", ...email }] }),
      {
        content: {
          "cs-CZ": {
            subject: "Synthetic subject",
            preheader: "Synthetic preheader",
            bodyMarkdown: "Hi",
          },
        },
      }
    );
    expect(withPreheader.getByText("Synthetic preheader")).not.toBeNull();
    cleanup();

    const withoutContent = renderResults(
      automationDryRunFixture({ emails: [{ locale: "cs-CZ", ...email }] })
    );
    expect(
      withoutContent.getByText(
        m.emailCampaignsEmailPreviewNoPreheader({}, { locale })
      )
    ).not.toBeNull();
  });

  test("leaves out the email without a rendered locale", () => {
    const view = renderResults(automationDryRunFixture());

    expect(
      view.queryByText(m.emailAutomationActivationEmailTitle({}, { locale }))
    ).toBeNull();
  });
});
