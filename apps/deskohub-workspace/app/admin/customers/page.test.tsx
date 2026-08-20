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
      input: { direction: "desc", page: 1, sort: "activity" },
      result: { items: [], page: 1, pageCount: 1, total: 24 },
    }),
  loadAdministrationCustomersPage: () => ({
    input: Promise.resolve({ direction: "desc", page: 1, sort: "activity" }),
    result: Promise.resolve({
      items: [],
      page: 1,
      pageCount: 1,
      total: 24,
    }),
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
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("24 customers").textContent).toBe("24");
    expect(view.queryByText("24 customers")).toBeNull();
  });
});
