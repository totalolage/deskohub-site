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
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceRouterRefresh } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { captureCampaignOperations } from "../../campaign-operation-actions.test-utils";
import {
  activeVersionFixture,
  automationDetailFixture,
  fixtureCampaignId,
} from "./automation-detail.test-utils";

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

// Radix picks its layout effect when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();

const { AutomationLifecycleActions } = await import(
  "./automation-lifecycle-actions"
);

const operations = captureCampaignOperations();
const locale = "en-US";
const label = {
  pause: m.emailAutomationActivationPause({}, { locale }),
  resume: m.emailAutomationActivationResume({}, { locale }),
  archive: m.emailAutomationActivationArchive({}, { locale }),
  archiveConfirm: m.emailAutomationActivationArchiveConfirm({}, { locale }),
  previewAndActivate: m.emailAutomationActivationPreviewAndActivate(
    {},
    { locale }
  ),
  previewChanges: m.emailAutomationActivationPreviewChanges({}, { locale }),
};
const previewHref = `/${locale}/admin/email-campaigns/${fixtureCampaignId}/preview`;
const ownCampaign = { input: { campaignId: fixtureCampaignId } };

const renderActions = (automation: AutomationDetail) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AutomationLifecycleActions automation={automation} />
    </RouteLocaleProvider>
  );

const published = (overrides: Parameters<typeof automationDetailFixture>[0]) =>
  automationDetailFixture({
    activeVersion: activeVersionFixture(),
    versionCount: 1,
    activation: { _tag: "Published" },
    ...overrides,
  });

const buttonNames = (view: ReturnType<typeof renderActions>) =>
  view
    .queryAllByRole("button")
    .map((button) => button.textContent)
    .sort();

describe("AutomationLifecycleActions", () => {
  beforeEach(() => {
    operations.install();
    workspaceRouterRefresh.mockClear();
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("offers the way to the preview and Archive for a draft", () => {
    const view = renderActions(automationDetailFixture({ status: "draft" }));

    expect(buttonNames(view)).toEqual([label.archive]);
    expect(
      view
        .getByRole("link", { name: label.previewAndActivate })
        .getAttribute("href")
    ).toBe(previewHref);
  });

  test("offers Pause and Archive for an active automation", () => {
    const view = renderActions(published({ status: "active" }));

    expect(buttonNames(view)).toEqual([label.archive, label.pause].sort());
    expect(view.queryAllByRole("link")).toHaveLength(0);
  });

  test("offers Resume and Archive for a paused automation", () => {
    const view = renderActions(
      published({ status: "paused", pausedAt: "2026-10-04T08:00:00.000Z" })
    );

    expect(buttonNames(view)).toEqual([label.archive, label.resume].sort());
  });

  test("links to the changes' preview while a live automation has pending changes", () => {
    const view = renderActions(
      published({ status: "active", pendingChanges: true })
    );

    expect(
      view
        .getByRole("link", { name: label.previewChanges })
        .getAttribute("href")
    ).toBe(previewHref);
  });

  test("renders nothing once archived", () => {
    const view = renderActions(
      published({ status: "archived", archivedAt: "2026-10-04T08:00:00.000Z" })
    );

    expect(view.container.innerHTML).toBe("");
  });

  test.each([
    {
      status: "active" as const,
      button: label.pause,
      operation: "pauseAutomation",
    },
    {
      status: "paused" as const,
      button: label.resume,
      operation: "resumeAutomation",
    },
  ])(
    "$operation runs straight from its button",
    ({ status, button, operation }) => {
      const view = renderActions(published({ status }));

      fireEvent.click(view.getByRole("button", { name: button }));

      expect(operations.requests(operation)).toEqual([
        { operation, ...ownCampaign },
      ]);
      expect(view.queryByRole("dialog")).toBeNull();
      operations.respond(operation, { _tag: "Success", output: {} });
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    }
  );

  test("shows the port's refusal of a pause", () => {
    const view = renderActions(published({ status: "active" }));

    fireEvent.click(view.getByRole("button", { name: label.pause }));
    operations.respond("pauseAutomation", {
      _tag: "Failure",
      code: "automation-status-conflict",
      message: "Port message",
    });

    expect(view.getByRole("alert").textContent).toBe(
      m.emailAutomationActivationFailureStatusConflict({}, { locale })
    );
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });

  test.each([
    {
      status: "draft",
      automation: () => automationDetailFixture({ status: "draft" }),
    },
    { status: "active", automation: () => published({ status: "active" }) },
  ])(
    "archives a $status automation only after the confirmation",
    ({ automation }) => {
      const view = renderActions(automation());

      fireEvent.click(view.getByRole("button", { name: label.archive }));
      const dialog = view.getByRole("dialog");
      expect(operations.requests("archiveAutomation")).toEqual([]);

      fireEvent.click(view.getByRole("button", { name: label.archiveConfirm }));
      expect(operations.requests("archiveAutomation")).toEqual([
        { operation: "archiveAutomation", ...ownCampaign },
      ]);
      expect(dialog.isConnected).toBe(true);

      operations.respond("archiveAutomation", { _tag: "Success", output: {} });
      expect(view.queryByRole("dialog")).toBeNull();
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    }
  );

  test("keeps the confirmation open with the port's refusal of an archive", () => {
    const view = renderActions(published({ status: "paused" }));
    fireEvent.click(view.getByRole("button", { name: label.archive }));
    fireEvent.click(view.getByRole("button", { name: label.archiveConfirm }));

    operations.respond("archiveAutomation", {
      _tag: "Failure",
      code: "automation-archived",
      message: "Port message",
    });

    expect(view.getByRole("dialog").textContent).toContain(
      m.emailAutomationActivationFailureArchived({}, { locale })
    );
    expect(workspaceRouterRefresh).not.toHaveBeenCalled();
  });
});
