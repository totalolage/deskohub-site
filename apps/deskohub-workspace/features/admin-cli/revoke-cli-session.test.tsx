import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import {
  CliSessionId,
  type CliSessionIdType,
} from "@deskohub/workspace-admin-api";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const revokeCliSessionAction = mock((_formData: FormData) => Promise.resolve());

mock.module("./actions", () => ({
  approveCliAuthentication: mock(),
  renameCliSession: mock(),
  revokeCliSession: revokeCliSessionAction,
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  revokeCliSessionAction.mockReset();
  revokeCliSessionAction.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const sessionId = CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00292");

const renderComponent = async (id: CliSessionIdType = sessionId) => {
  const { RevokeCliSession } = await import("./revoke-cli-session");
  return render(
    <RevokeCliSession clientName="Office Mac" revoked={false} sessionId={id} />
  );
};

const openDialog = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Revoke" }));
  });
  return view.getByRole("dialog");
};

const submitDialog = async (dialog: HTMLElement) => {
  await act(async () => {
    fireEvent.submit(dialog.querySelector("form")!);
    await Promise.resolve();
  });
};

test("requires confirmation and submits only the session ID to the server action", async () => {
  const view = await renderComponent();
  let dialog = await openDialog(view);

  expect(dialog.textContent).toContain("Revoke CLI session?");
  expect(dialog.textContent).toContain("“Office Mac”");
  expect(revokeCliSessionAction).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(revokeCliSessionAction).not.toHaveBeenCalled();

  dialog = await openDialog(view);
  await submitDialog(dialog);

  expect(revokeCliSessionAction).toHaveBeenCalledTimes(1);
  const formData = revokeCliSessionAction.mock.calls[0]?.[0] as FormData;
  expect([...formData.keys()]).toEqual(["sessionId"]);
  expect(formData.get("sessionId")).toBe(sessionId);
});

test("asks for confirmation in Czech on a Czech route", async () => {
  const { RevokeCliSession } = await import("./revoke-cli-session");
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <RevokeCliSession
        clientName="Office Mac"
        revoked={false}
        sessionId={sessionId}
      />
    </RouteLocaleProvider>
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Odvolat" }));
  });
  const dialog = view.getByRole("dialog");

  expect(dialog.textContent).toContain("Odvolat relaci CLI?");
  expect(dialog.textContent).toContain("„Office Mac“");
  expect(view.getByRole("button", { name: "Odvolat přístup" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Zavřít" })).toBeTruthy();
});
