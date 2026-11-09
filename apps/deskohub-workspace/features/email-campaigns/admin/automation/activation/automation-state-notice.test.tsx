import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { formatAdministrationDateTime } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { automationDetailFixture } from "./automation-detail.test-utils";
import { AutomationStateNotice } from "./automation-state-notice";

registerWorkspaceComponentTestEnv();

const locale = "en-US";
const pausedAt = "2026-10-03T08:00:00.000Z";
const archivedAt = "2026-10-04T08:00:00.000Z";

const noticeText = (automation: ReturnType<typeof automationDetailFixture>) =>
  render(<AutomationStateNotice automation={automation} locale={locale} />)
    .container.textContent;

describe("AutomationStateNotice", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("dates a paused automation's pause", () => {
    expect(
      noticeText(automationDetailFixture({ status: "paused", pausedAt }))
    ).toBe(
      m.emailAutomationActivationPausedNotice(
        { date: formatAdministrationDateTime(pausedAt, locale) },
        { locale }
      )
    );
  });

  test("dates an archived automation's archiving", () => {
    expect(
      noticeText(
        automationDetailFixture({ status: "archived", pausedAt, archivedAt })
      )
    ).toBe(
      m.emailAutomationActivationArchivedNotice(
        { date: formatAdministrationDateTime(archivedAt, locale) },
        { locale }
      )
    );
  });

  test.each([
    ["a draft", { status: "draft", pausedAt, archivedAt }],
    ["an undated pause", { status: "paused" }],
    ["an undated archive", { status: "archived" }],
  ] as const)("shows nothing for %s", (_, overrides) => {
    expect(noticeText(automationDetailFixture(overrides))).toBe("");
  });
});
