import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@/features/accounting/actions/manage-post-order-invoice", () => ({
  managePostOrderInvoice: async () => ({}),
}));

const { PostOrderInvoicePage } = await import("./post-order-invoice-page");

describe("PostOrderInvoicePage", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  beforeEach(() => {
    workspaceUseAction.mockReset();
    workspaceUseAction.mockReturnValue({
      execute: mock(),
      isExecuting: false,
    } as never);
  });
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("renders a blank masked personal billing form with visible validation", async () => {
    const view = render(
      <PostOrderInvoicePage
        accessToken="signed-capability"
        initialState="create"
        locale="en-US"
        orderId={"reservation-id" as never}
      />
    );

    expect((view.getByLabelText("Address") as HTMLInputElement).value).toBe("");
    expect(view.queryByLabelText("Legal company name")).toBeNull();
    expect(view.queryByLabelText("Email")).toBeNull();
    expect(view.getByRole("option", { name: "Czechia" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Create invoice" })).toBeTruthy();
    expect(
      view.container
        .querySelector("[data-post-order-invoice]")
        ?.getAttribute("data-ph-no-capture")
    ).toBe("");

    const form = view.container.querySelector("form");
    if (!form) throw new Error("Invoice form missing");
    fireEvent.submit(form);
    expect(
      (await view.findAllByText("This field is required.")).length
    ).toBeGreaterThan(0);
  });

  test("shows only resend controls for an issued invoice", () => {
    const view = render(
      <PostOrderInvoicePage
        accessToken="signed-capability"
        initialState="issued"
        locale="en-US"
        orderId={"reservation-id" as never}
      />
    );

    expect(view.getByText("An invoice was already generated")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Resend invoice to email" })
    ).toBeTruthy();
    expect(view.queryByLabelText("Address")).toBeNull();
  });

  test("localizes country names for Czech billing forms", () => {
    const view = render(
      <PostOrderInvoicePage
        accessToken="signed-capability"
        initialState="create"
        locale="cs-CZ"
        orderId={"reservation-id" as never}
      />
    );

    expect(view.getByRole("option", { name: "Česko" })).toBeTruthy();
  });

  test("clears the delivery warning after a successful resend", () => {
    let onSuccess:
      | ((result: { data: { status: "resent" } }) => void)
      | undefined;
    workspaceUseAction.mockImplementation((_action, options) => {
      onSuccess = (options as { onSuccess?: typeof onSuccess }).onSuccess;
      return { execute: mock(), isExecuting: false } as never;
    });
    const view = render(
      <PostOrderInvoicePage
        accessToken="signed-capability"
        initialDeliveryFailed
        initialState="created"
        locale="en-US"
        orderId={"reservation-id" as never}
      />
    );

    expect(view.getByText(/could not be sent/)).toBeTruthy();
    act(() => onSuccess?.({ data: { status: "resent" } }));

    expect(view.queryByText(/could not be sent/)).toBeNull();
    expect(view.queryByRole("button")).toBeNull();
    expect(view.getByText("The invoice was resent.")).toBeTruthy();
  });
});
