import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { CliSessionId } from "@deskohub/workspace-admin-api";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const execute = mock();

interface RenameCliSessionActionInput {
  readonly sessionId: string;
  readonly clientName: string;
}

type ActionOptions = {
  readonly execute: (input: RenameCliSessionActionInput) => void;
  readonly isExecuting: boolean;
  readonly onSuccess: (args: { readonly data?: unknown }) => void;
  readonly onError: (args: {
    readonly error: { readonly serverError?: string };
  }) => void;
  readonly onTransportError: () => void;
};

let actionOptions: ActionOptions | undefined;

mock.module("./actions", () => ({
  renameCliSession: mock(),
  revokeCliSession: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  execute.mockClear();
  actionOptions = undefined;
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation(() => ({
    execute,
    isExecuting: false,
    result: {},
  }));
});

const withActionOptions = () => {
  workspaceUseAction.mockImplementation((_action, options) => {
    actionOptions = options as ActionOptions | undefined;
    return { execute, isExecuting: false, result: {} };
  });
};

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const sessionId = CliSessionId.make("019f70bd-0131-7f30-9f8a-48e768f00292");

const fieldMessage = (container: HTMLElement) =>
  container.querySelector('p[aria-live="polite"]');

const openDialog = async (view: ReturnType<typeof render>) => {
  fireEvent.click(view.getByRole("button", { name: "Rename" }));
  await act(async () => {});
  return view.getByRole("dialog");
};

const submitForm = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.submit(view.getByRole("dialog").querySelector("form")!);
  });
};

const renderComponent = async () => {
  const { RenameCliSession } = await import("./rename-cli-session");
  return render(
    <RenameCliSession clientName="Office Mac" sessionId={sessionId} />
  );
};

test("keeps the field at the current client label when the dialog opens", async () => {
  const view = await renderComponent();
  const dialog = await openDialog(view);

  const input = dialog.querySelector("input") as HTMLInputElement;
  expect(input.value).toBe("Office Mac");
  expect(input.maxLength).toBe(80);
  expect(execute).not.toHaveBeenCalled();
});

test("reports a blank label as a field error without calling the action", async () => {
  const view = await renderComponent();
  const dialog = await openDialog(view);

  const input = dialog.querySelector("input") as HTMLInputElement;
  await act(async () => {
    fireEvent.input(input, { target: { value: "   " } });
  });
  await submitForm(view);

  expect(fieldMessage(dialog)).not.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

test("reports an overlong label as a field error without calling the action", async () => {
  const view = await renderComponent();
  const dialog = await openDialog(view);

  const input = dialog.querySelector("input") as HTMLInputElement;
  await act(async () => {
    fireEvent.input(input, { target: { value: "x".repeat(81) } });
  });
  await submitForm(view);

  expect(fieldMessage(dialog)).not.toBeNull();
  expect(execute).not.toHaveBeenCalled();
});

test("submits the exact action args and closes the dialog on success", async () => {
  withActionOptions();
  const view = await renderComponent();
  const dialog = await openDialog(view);

  const input = dialog.querySelector("input") as HTMLInputElement;
  fireEvent.input(input, { target: { value: "Booth Terminal" } });
  await submitForm(view);

  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.calls[0][0]).toEqual({
    sessionId,
    clientName: "Booth Terminal",
  });

  act(() => {
    actionOptions?.onSuccess({
      data: { notice: "CLI session label updated." },
    });
  });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.queryByRole("status")).toBeNull();
});

test("shows the not-found server error", async () => {
  withActionOptions();
  const view = await renderComponent();
  await openDialog(view);
  await submitForm(view);

  act(() => {
    actionOptions?.onError({
      error: { serverError: "That CLI session no longer exists." },
    });
  });

  expect(view.getByRole("alert").textContent).toBe(
    "That CLI session no longer exists."
  );
});

test("shows the fallback wording on a transport error", async () => {
  withActionOptions();
  const view = await renderComponent();
  await openDialog(view);
  await submitForm(view);

  act(() => {
    actionOptions?.onTransportError();
  });

  expect(view.getByRole("alert").textContent).toBe(
    "The CLI session label could not be updated."
  );
});

test("clears the error and restores the current label on close and reopen", async () => {
  withActionOptions();
  const view = await renderComponent();
  const dialog = await openDialog(view);

  const input = dialog.querySelector("input") as HTMLInputElement;
  fireEvent.input(input, { target: { value: "   " } });
  await submitForm(view);
  expect(fieldMessage(dialog)).not.toBeNull();

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  });
  await act(async () => {});

  const reopened = await openDialog(view);
  const reopenedInput = reopened.querySelector("input") as HTMLInputElement;
  expect(reopenedInput.value).toBe("Office Mac");
  expect(fieldMessage(reopened)).toBeNull();
  expect(reopened.querySelector("[role='alert']")).toBeNull();
  expect(execute).not.toHaveBeenCalled();
});
