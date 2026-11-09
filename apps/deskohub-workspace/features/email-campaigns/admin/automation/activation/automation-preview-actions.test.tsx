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
  AdministrationCampaignId,
  AutomationPreviewId,
} from "@deskohub/workspace-admin-api";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceRouterReplace } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { captureCampaignOperations } from "../../campaign-operation-actions.test-utils";
import { fixtureCampaignId } from "./automation-detail.test-utils";

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();

const { AutomationActivateButton, AutomationDryRunButton } = await import(
  "./automation-preview-actions"
);

const operations = captureCampaignOperations();
const locale = "en-US";
const campaignId = AdministrationCampaignId.make(fixtureCampaignId);
const previewId = AutomationPreviewId.make("preview-ready");
const previewHref = (id: string) =>
  `/${locale}/admin/email-campaigns/${fixtureCampaignId}/preview?preview=${id}`;
const activateLabel = m.emailAutomationActivationActivate({}, { locale });
const publishLabel = m.emailAutomationActivationPublish({}, { locale });

describe("automation preview actions", () => {
  beforeEach(() => {
    operations.install();
    workspaceRouterReplace.mockClear();
  });
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  describe("AutomationActivateButton", () => {
    const renderButton = (
      props: Partial<Parameters<typeof AutomationActivateButton>[0]> = {}
    ) =>
      render(
        <RouteLocaleProvider locale={locale}>
          <AutomationActivateButton
            campaignId={campaignId}
            previewId={previewId}
            publishesChanges={false}
            {...props}
          />
        </RouteLocaleProvider>
      );
    const activate = (view: ReturnType<typeof renderButton>) =>
      fireEvent.click(view.getByRole("button", { name: activateLabel }));

    test("stays disabled without a ready dry run", () => {
      const view = renderButton({ previewId: undefined });

      expect(
        view
          .getByRole("button", { name: activateLabel })
          .hasAttribute("disabled")
      ).toBe(true);
      activate(view);
      expect(operations.requests("activateAutomation")).toEqual([]);
    });

    test("activates the ready dry run through the port", () => {
      activate(renderButton());

      expect(operations.requests("activateAutomation")).toEqual([
        { operation: "activateAutomation", input: { campaignId, previewId } },
      ]);
    });

    test("is the publish action once a version is live", () => {
      const view = renderButton({ publishesChanges: true });

      expect(view.queryByRole("button", { name: activateLabel })).toBeNull();
      expect(view.getByRole("button", { name: publishLabel })).toBeDefined();
    });

    test("returns to the activated dry run's preview", () => {
      activate(renderButton());
      operations.respond("activateAutomation", {
        _tag: "Success",
        output: {},
      });

      expect(workspaceRouterReplace).toHaveBeenCalledWith(
        previewHref(previewId)
      );
    });

    test.each([
      ["flow-invalid", m.emailAutomationActivationFailureFlowInvalid],
      ["audience-archived", m.emailAutomationActivationFailureAudienceArchived],
      [
        "automation-preview-required",
        m.emailAutomationActivationFailurePreviewRequired,
      ],
      [
        "automation-draft-changed",
        m.emailAutomationActivationFailureDraftChanged,
      ],
      [
        "fallback-content-missing",
        m.emailAutomationActivationFailureFallbackContentMissing,
      ],
      ["automation-archived", m.emailAutomationActivationFailureArchived],
      [
        "automation-status-conflict",
        m.emailAutomationActivationFailureStatusConflict,
      ],
      ["not-a-known-code", m.emailAutomationActivationActivateFailed],
    ] as const)("shows the port's %s refusal as its own copy", (code, copy) => {
      const view = renderButton();
      activate(view);

      operations.respond("activateAutomation", {
        _tag: "Failure",
        code,
        message: "Port message",
      });

      expect(view.getByRole("alert").textContent).toBe(copy({}, { locale }));
      expect(workspaceRouterReplace).not.toHaveBeenCalled();
    });
  });

  describe("AutomationDryRunButton", () => {
    const renderButton = (again: boolean) =>
      render(
        <RouteLocaleProvider locale={locale}>
          <AutomationDryRunButton again={again} campaignId={campaignId} />
        </RouteLocaleProvider>
      );

    test("starts a dry run and keeps its job in the URL", () => {
      const view = renderButton(false);

      fireEvent.click(view.getByRole("button"));

      expect(operations.requests("dryRunAutomation")).toEqual([
        { operation: "dryRunAutomation", input: { campaignId } },
      ]);
      operations.respond("dryRunAutomation", {
        _tag: "Success",
        output: { previewId: "preview-new" },
      });
      expect(workspaceRouterReplace).toHaveBeenCalledWith(
        previewHref("preview-new")
      );
    });

    test("words a run again differently from a first run", () => {
      const first = renderButton(false).getByRole("button").textContent;
      cleanup();
      const again = renderButton(true).getByRole("button").textContent;

      expect(first).toBe(m.emailAutomationActivationRun({}, { locale }));
      expect(again).toBe(m.emailAutomationActivationRunAgain({}, { locale }));
    });

    test("shows an invalid flow refusal", () => {
      const view = renderButton(false);
      fireEvent.click(view.getByRole("button"));

      operations.respond("dryRunAutomation", {
        _tag: "Failure",
        code: "flow-invalid",
        message: "Port message",
      });

      expect(view.getByRole("alert").textContent).toBe(
        m.emailAutomationActivationFailureFlowInvalid({}, { locale })
      );
    });
  });
});
