import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const approveCliAuthenticationAction = mock((_formData: FormData) =>
  Promise.resolve()
);

mock.module("@/features/admin-cli/actions", () => ({
  approveCliAuthentication: approveCliAuthenticationAction,
  renameCliSession: mock(),
  revokeCliSession: mock(),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  approveCliAuthenticationAction.mockReset();
  approveCliAuthenticationAction.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

const code = "A".repeat(43);

const renderComponent = async (value: string | undefined = code) => {
  const { ApproveCliAuthenticationForm } = await import(
    "./approve-cli-authentication-form"
  );
  return render(<ApproveCliAuthenticationForm code={value} />);
};

const submitForm = async (view: ReturnType<typeof render>) => {
  await act(async () => {
    fireEvent.submit(view.container.querySelector("form")!);
    await Promise.resolve();
  });
};

test("validates the hidden code and submits it through the approval server action", async () => {
  const view = await renderComponent();
  const hiddenInput = view.container.querySelector(
    'input[type="hidden"]'
  ) as HTMLInputElement;
  expect(hiddenInput.value).toBe(code);

  await submitForm(view);

  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);
  const formData = approveCliAuthenticationAction.mock
    .calls[0]?.[0] as FormData;
  expect([...formData.keys()]).toEqual(["code"]);
  expect(formData.get("code")).toBe(code);
});

test("does not call the approval action when the code schema rejects the value", async () => {
  const view = await renderComponent("invalid-code");

  await submitForm(view);

  expect(approveCliAuthenticationAction).not.toHaveBeenCalled();
});

test("shows pending approval and prevents duplicate server-action submissions", async () => {
  let resolveAction!: () => void;
  const actionPromise = new Promise<void>((resolve) => {
    resolveAction = resolve;
  });
  approveCliAuthenticationAction.mockImplementationOnce(() => actionPromise);

  const view = await renderComponent();
  const form = view.container.querySelector("form")!;

  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });

  const submit = view.getByRole("button", { name: "Approve this CLI" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(submit.getAttribute("aria-busy")).toBe("true");
  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);

  await act(async () => {
    fireEvent.submit(form);
    await Promise.resolve();
  });
  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);

  await act(async () => {
    resolveAction();
    await actionPromise;
  });
});
