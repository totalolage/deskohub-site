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

test("reports an invalid duration in Czech on a Czech route", async () => {
  const { ApproveCliAuthenticationForm } = await import(
    "./approve-cli-authentication-form"
  );
  const { RouteLocaleProvider } = await import("@/features/i18n/route-locale");
  const view = render(
    <RouteLocaleProvider locale="cs-CZ">
      <ApproveCliAuthenticationForm code={code} />
    </RouteLocaleProvider>
  );

  fireEvent.input(view.getByLabelText("Délka"), { target: { value: "0" } });
  await submitForm(view);

  expect(approveCliAuthenticationAction).not.toHaveBeenCalled();
  expect(view.getByText("Zadejte celé číslo od 1 do 999.")).toBeTruthy();
  expect(view.getByRole("button", { name: "Schválit toto CLI" })).toBeTruthy();
});
