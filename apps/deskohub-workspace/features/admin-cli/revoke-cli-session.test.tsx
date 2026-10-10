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

test("does not call the server action when the session ID schema rejects the value", async () => {
  const view = await renderComponent("not-a-session-id" as CliSessionIdType);
  const dialog = await openDialog(view);

  await submitDialog(dialog);

  expect(revokeCliSessionAction).not.toHaveBeenCalled();
});

test("keeps the confirmation submit pending and prevents duplicate submissions", async () => {
  let resolveAction!: () => void;
  const actionPromise = new Promise<void>((resolve) => {
    resolveAction = resolve;
  });
  revokeCliSessionAction.mockImplementationOnce(() => actionPromise);

  const view = await renderComponent();
  const dialog = await openDialog(view);
  const form = dialog.querySelector("form")!;

  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });

  const submit = view.getByRole("button", { name: "Revoking…" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(revokeCliSessionAction).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  expect(revokeCliSessionAction).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveAction();
    await actionPromise;
  });
});
