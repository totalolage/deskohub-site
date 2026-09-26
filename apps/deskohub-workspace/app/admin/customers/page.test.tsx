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
import type { AdministrationCustomerListInput } from "@/features/administration/administration.service";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

type CustomerItem = {
  customer: {
    displayName: string;
    email: string;
    phone: string;
  } | null;
  customerId: string;
  lastActivityAt: string;
  marketingConsent: "granted" | "never" | "withdrawn";
  reservationCount: number;
};

let mockInput: AdministrationCustomerListInput;
let mockItems: readonly CustomerItem[];

const resetMocks = () => {
  mockInput = { direction: "desc", page: 1, sort: "activity" };
  mockItems = [];
};

resetMocks();

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationCustomers: () =>
    Promise.resolve({
      input: mockInput,
      result: { items: mockItems, page: 1, pageCount: 2, total: 24 },
    }),
  loadAdministrationCustomersPage: () => ({
    input: Promise.resolve(mockInput),
    result: Promise.resolve({
      items: mockItems,
      page: 1,
      pageCount: 2,
      total: 24,
    }),
  }),
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => <input aria-label="Customer name or email" />,
}));

const customerWithDetails = (
  consent: CustomerItem["marketingConsent"],
  customerId: string
): CustomerItem => ({
  customer: {
    displayName: `Customer ${customerId}`,
    email: `${customerId}@example.com`,
    phone: "+420000000",
  },
  customerId,
  lastActivityAt: "2026-08-14T12:00:00Z",
  marketingConsent: consent,
  reservationCount: 2,
});

describe("DiscountCustomersAdminPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    resetMocks();
  });
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

  test("renders the consent filter with four options and keeps the selection", async () => {
    const { CustomerFilters } = await import("./page");
    const view = render(
      <CustomerFilters
        input={{
          direction: "desc",
          marketingConsent: "granted",
          page: 1,
          sort: "activity",
        }}
      />
    );

    const select = view.getByLabelText(
      "Marketing consent"
    ) as HTMLSelectElement;
    expect(select).toBeDefined();
    const options = Array.from(select.options).map((option) => option.value);
    expect(options).toEqual(["", "granted", "withdrawn", "never"]);
    expect(select.value).toBe("granted");
    expect(view.getByRole("button", { name: "Apply filters" })).toBeDefined();
  });

  test("renders consent state in the desktop table and mobile rows", async () => {
    mockItems = [
      customerWithDetails("granted", "customer-a"),
      customerWithDetails("withdrawn", "customer-b"),
      customerWithDetails("never", "customer-c"),
    ];
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getAllByText("Granted").length).toBe(2);
    expect(view.getAllByText("Withdrawn").length).toBe(2);
    expect(view.getAllByText("Never granted").length).toBe(2);

    const mobileList = view.getByRole("list");
    expect(mobileList.textContent).toContain("Granted");
    expect(mobileList.textContent).toContain("Withdrawn");
    expect(mobileList.textContent).toContain("Never granted");
  });

  test("renders consent state for rows without provider contact details", async () => {
    mockItems = [
      {
        customer: null,
        customerId: "customer-x",
        lastActivityAt: "2026-08-14T12:00:00Z",
        marketingConsent: "granted",
        reservationCount: 1,
      },
    ];
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getAllByText("Granted").length).toBe(2);
  });

  test("shows the filter-specific empty state when a consent filter is active", async () => {
    mockInput = {
      direction: "desc",
      marketingConsent: "never",
      page: 1,
      sort: "activity",
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      view.getByText("No customers match this marketing consent filter.")
    ).toBeDefined();
  });

  test("keeps the default empty state without a consent filter", async () => {
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByText("No customers have reservations yet.")).toBeDefined();
  });

  test("preserves the consent filter in pagination and sort links", async () => {
    mockInput = {
      direction: "desc",
      marketingConsent: "granted",
      page: 1,
      sort: "activity",
    };
    mockItems = [customerWithDetails("granted", "customer-a")];
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    const hrefs = Array.from(view.container.querySelectorAll("a")).map(
      (anchor) => anchor.getAttribute("href")
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      if (href?.includes("sort=") || href?.includes("page=2")) {
        expect(href).toContain("consent=granted");
      }
      expect(href).not.toContain("customer-a@example.com");
      expect(href).not.toContain("Customer%20");
      expect(href).not.toContain("+420000000");
    }
    expect(
      hrefs.some((href) => href?.includes("consent=granted&direction=desc"))
    ).toBe(true);
  });
});
