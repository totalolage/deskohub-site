import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type {
  AutomationDetail,
  AutomationDryRun,
} from "@deskohub/workspace-admin-api";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AutomatedCampaign } from "../automated-campaign.server";
import {
  activeVersionFixture,
  automationDetailFixture,
  fixtureCampaignId,
} from "./automation-detail.test-utils";

const locale = "en-US";
/** The settled dry run job the page reads, by its status alone. */
type SettledDryRun = Pick<AutomationDryRun, "status" | "errorCode">;
const loadAutomationDryRun = mock(
  async (): Promise<SettledDryRun | undefined> => undefined
);

mock.module("@/features/i18n/server/request-locale", () => ({
  getRequestLocale: async () => locale,
}));
mock.module("./automation-dry-run.server", () => ({ loadAutomationDryRun }));
mock.module("./automation-dry-run-polling", () => ({
  AutomationDryRunPolling: () => <span data-testid="dry-run-polling" />,
}));
mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();

const { AutomationPreviewPage } = await import("./automation-preview-page");

const execute = mock();
const label = {
  activate: m.emailAutomationActivationActivate({}, { locale }),
  publish: m.emailAutomationActivationPublish({}, { locale }),
  run: m.emailAutomationActivationRun({}, { locale }),
  runAgain: m.emailAutomationActivationRunAgain({}, { locale }),
};

const renderPage = async (automation: AutomationDetail) =>
  render(
    <RouteLocaleProvider locale={locale}>
      {
        await AutomationPreviewPage({
          automated: {
            campaign: {} as AutomatedCampaign["campaign"],
            automation,
          },
        })
      }
    </RouteLocaleProvider>
  );

const controls = (view: Awaited<ReturnType<typeof renderPage>>) => ({
  activate: view.queryByRole("button", { name: label.activate }),
  publish: view.queryByRole("button", { name: label.publish }),
  run: view.queryByRole("button", { name: label.run }),
  runAgain: view.queryByRole("button", { name: label.runAgain }),
  progress: view.queryByRole("progressbar"),
  polling: view.queryByTestId("dry-run-polling"),
});

const ready = { _tag: "Ready", previewId: "preview-ready", draftHash: "hash" };
const running = {
  _tag: "PreviewRunning",
  previewId: "preview-running",
  unitsDone: 3,
  unitsTotal: 10,
};

describe("AutomationPreviewPage activation gate", () => {
  beforeEach(() => {
    execute.mockClear();
    loadAutomationDryRun.mockReset();
    loadAutomationDryRun.mockImplementation(async () => undefined);
    workspaceUseAction.mockReset();
    workspaceUseAction.mockImplementation(
      () => ({ execute, isExecuting: false }) as never
    );
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("asks for a dry run before Activate", async () => {
    const view = await renderPage(automationDetailFixture());
    const shown = controls(view);

    expect(shown.run).not.toBeNull();
    expect(shown.activate?.hasAttribute("disabled")).toBe(true);
    expect(shown.progress).toBeNull();
    expect(shown.polling).toBeNull();
  });

  test("shows a running dry run's progress and polls it, with Activate disabled", async () => {
    const view = await renderPage(
      automationDetailFixture({ activation: running })
    );
    const shown = controls(view);

    expect(shown.progress?.getAttribute("aria-valuenow")).toBe("3");
    expect(shown.progress?.getAttribute("aria-valuemax")).toBe("10");
    expect(shown.polling).not.toBeNull();
    expect(shown.run).toBeNull();
    expect(shown.activate?.hasAttribute("disabled")).toBe(true);
  });

  test("enables Activate for the ready dry run, and only then", async () => {
    const view = await renderPage(
      automationDetailFixture({ activation: ready })
    );
    const shown = controls(view);

    expect(shown.activate?.hasAttribute("disabled")).toBe(false);
    expect(shown.run).toBeNull();
    expect(shown.polling).toBeNull();
    expect(view.getByRole("status").textContent).not.toBe("");

    fireEvent.click(shown.activate as HTMLElement);
    expect(execute).toHaveBeenCalledWith({
      operation: "activateAutomation",
      input: { campaignId: fixtureCampaignId, previewId: "preview-ready" },
    });
  });

  test("follows the port's readiness rather than judging the flow itself", async () => {
    const withoutFlow = await renderPage(
      automationDetailFixture({ flow: null, trigger: null, activation: ready })
    );
    expect(controls(withoutFlow).activate?.hasAttribute("disabled")).toBe(
      false
    );
    cleanup();

    const withFlow = await renderPage(automationDetailFixture());
    expect(controls(withFlow).activate?.hasAttribute("disabled")).toBe(true);
  });

  test("publishes changes to a live automation", async () => {
    const view = await renderPage(
      automationDetailFixture({
        status: "active",
        activeVersion: activeVersionFixture(),
        versionCount: 1,
        pendingChanges: true,
        activation: ready,
      })
    );
    const shown = controls(view);

    expect(shown.activate).toBeNull();
    expect(shown.publish?.hasAttribute("disabled")).toBe(false);
  });

  test("offers neither a dry run nor Activate once the working copy is live", async () => {
    const view = await renderPage(
      automationDetailFixture({
        status: "active",
        activeVersion: activeVersionFixture(),
        versionCount: 1,
        activation: { _tag: "Published" },
      })
    );

    expect(view.queryAllByRole("button")).toHaveLength(0);
  });

  test("offers no actions on an archived automation", async () => {
    const view = await renderPage(
      automationDetailFixture({
        status: "archived",
        archivedAt: "2026-10-04T08:00:00.000Z",
        activation: ready,
      })
    );

    expect(view.queryAllByRole("button")).toHaveLength(0);
  });

  test.each(["failed", "superseded"] as const)(
    "offers another dry run after the job %s, without Activate",
    async (status) => {
      loadAutomationDryRun.mockImplementation(async () => ({
        status,
        errorCode: "preview-stalled",
      }));
      const view = await renderPage(
        automationDetailFixture({ activation: running })
      );
      const shown = controls(view);

      expect(shown.runAgain).not.toBeNull();
      expect(shown.activate?.hasAttribute("disabled")).toBe(true);
      expect(shown.progress).toBeNull();
      expect(shown.polling).toBeNull();
    }
  );
});
