import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
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
    expect(
      view.getByRole("option", {
        name: "Falkland Islands (the) [Malvinas]",
      })
    ).toBeTruthy();
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
});
