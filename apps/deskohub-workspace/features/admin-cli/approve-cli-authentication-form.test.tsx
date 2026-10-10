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

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
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

test("validates the hidden code and submits it with the default session lifetime", async () => {
  const view = await renderComponent();
  const hiddenInput = view.container.querySelector(
    'input[type="hidden"]'
  ) as HTMLInputElement;
  expect(hiddenInput.value).toBe(code);

  await submitForm(view);

  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);
  const formData = approveCliAuthenticationAction.mock
    .calls[0]?.[0] as FormData;
  expect([...formData.entries()]).toEqual([
    ["code", code],
    ["lifetimeAmount", "30"],
    ["lifetimeUnit", "days"],
  ]);
});

test("submits only the never-expire choice while the duration is disabled", async () => {
  const view = await renderComponent();
  const amount = view.getByLabelText("Duration") as HTMLInputElement;

  fireEvent.input(amount, { target: { value: "0" } });
  await act(async () => {
    fireEvent.click(view.getByRole("checkbox", { name: "Never expire" }));
  });
  expect(amount.disabled).toBe(true);
  expect(
    view.getByRole("combobox", { name: "Unit" }).hasAttribute("disabled")
  ).toBe(true);

  await submitForm(view);

  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);
  const formData = approveCliAuthenticationAction.mock
    .calls[0]?.[0] as FormData;
  expect([...formData.entries()]).toEqual([
    ["code", code],
    ["neverExpire", "on"],
  ]);
});

test("submits a changed duration amount and unit", async () => {
  const view = await renderComponent();

  fireEvent.input(view.getByLabelText("Duration"), {
    target: { value: "6" },
  });
  const unit = view.getByRole("combobox", { name: "Unit" });
  await act(async () => {
    fireEvent.keyDown(unit, { key: "Enter" });
  });
  await act(async () => {
    fireEvent.click(view.getByRole("option", { name: "Months" }));
  });
  expect(unit.textContent).toBe("Months");

  await submitForm(view);

  expect(approveCliAuthenticationAction).toHaveBeenCalledTimes(1);
  const formData = approveCliAuthenticationAction.mock
    .calls[0]?.[0] as FormData;
  expect([...formData.entries()]).toEqual([
    ["code", code],
    ["lifetimeAmount", "6"],
    ["lifetimeUnit", "months"],
  ]);
});

test("clears the duration error while never expire is checked and restores it when unchecked", async () => {
  const view = await renderComponent();
  const amount = view.getByLabelText("Duration") as HTMLInputElement;
  const neverExpire = view.getByRole("checkbox", { name: "Never expire" });
  const durationError = "Enter a whole number from 1 to 999.";

  fireEvent.input(amount, { target: { value: "0" } });
  await submitForm(view);
  expect(view.getByText(durationError)).toBeTruthy();

  await act(async () => {
    fireEvent.click(neverExpire);
  });
  expect(view.queryByText(durationError)).toBeNull();

  await act(async () => {
    fireEvent.click(neverExpire);
  });
  expect(view.getByText(durationError)).toBeTruthy();
  expect(approveCliAuthenticationAction).not.toHaveBeenCalled();
});

test("rejects a session duration outside the allowed whole-number range", async () => {
  const view = await renderComponent();
  const amount = view.getByLabelText("Duration") as HTMLInputElement;

  for (const value of ["0", "1.5", "1000", ""]) {
    fireEvent.input(amount, { target: { value } });
    await submitForm(view);
  }

  expect(approveCliAuthenticationAction).not.toHaveBeenCalled();
  expect(view.getByText("Enter a whole number from 1 to 999.")).toBeTruthy();
  expect(amount.getAttribute("aria-invalid")).toBe("true");
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
