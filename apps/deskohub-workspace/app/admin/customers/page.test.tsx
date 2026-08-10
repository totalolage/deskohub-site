import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationCustomers: () =>
    Promise.resolve({
      items: [],
      page: 1,
      pageCount: 1,
      total: 24,
    }),
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => <input aria-label="Customer name or email" />,
}));

describe("DiscountCustomersAdminPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("uses the shared compact accessible table count", async () => {
    const { default: DiscountCustomersAdminPage } = await import("./page");
    const view = render(
      await DiscountCustomersAdminPage({ searchParams: Promise.resolve({}) })
    );

    expect(view.getByLabelText("24 customers").textContent).toBe("24");
    expect(view.queryByText("24 customers")).toBeNull();
  });
});
