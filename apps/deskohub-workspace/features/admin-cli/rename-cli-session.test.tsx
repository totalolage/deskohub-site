import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { CliSessionId } from "@deskohub/workspace-admin-api";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("./actions", () => ({
  approveCliAuthentication: mock(),
  renameCliSession: mock(),
  revokeCliSession: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  workspaceUseAction.mockReset();
  await unregisterWorkspaceComponentTestEnv();
});

test("labels the close button in Czech on a Czech route", async () => {
  const { RenameCliSession } = await import("./rename-cli-session");
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <RenameCliSession
        clientName="Office Mac"
        sessionId={CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00292")}
      />
    </RouteLocaleProvider>
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Přejmenovat" }));
  });

  expect(view.getByRole("button", { name: "Zavřít" })).toBeTruthy();
});
