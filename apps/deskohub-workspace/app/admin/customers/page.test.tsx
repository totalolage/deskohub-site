import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { AdministrationCustomerListInput } from "@/features/administration/administration.service";
import { AdministrationTableToolbar } from "@/features/administration/components";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));

type LoadedCustomersPage = {
  readonly input: AdministrationCustomerListInput;
  readonly result: {
    readonly dateFilterUnavailable: boolean;
    readonly items: readonly never[];
    readonly page: number;
    readonly pageCount: number;
    readonly total: number;
  };
};

const defaultCustomersPage: LoadedCustomersPage = {
  input: { direction: "desc", page: 1, sort: "activity" },
  result: {
    dateFilterUnavailable: false,
    items: [],
    page: 1,
    pageCount: 1,
    total: 24,
  },
};

let customerPage: LoadedCustomersPage = defaultCustomersPage;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationCustomers: () => Promise.resolve(customerPage),
  loadAdministrationCustomersPage: () => ({
    input: Promise.resolve(customerPage.input),
    result: Promise.resolve(customerPage.result),
  }),
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => <input aria-label="Customer name or email" />,
}));

describe("DiscountCustomersAdminPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    cleanup();
    customerPage = defaultCustomersPage;
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

  test("renders the date-range filter form with shortcuts and hidden sorting", async () => {
    customerPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "activity",
        to: "2026-08-10",
      },
      result: defaultCustomersPage.result,
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
      "2026-08-04"
    );
    expect(view.getByLabelText("Start date to").getAttribute("value")).toBe(
      "2026-08-10"
    );
    const form = view.getByLabelText("Start date from").closest("form");
    expect(form).not.toBeNull();
    expect(form!.querySelector('input[name="page"]')).toBeNull();
    expect(
      form!.querySelector('input[name="sort"]')!.getAttribute("value")
    ).toBe("activity");
    expect(
      form!.querySelector('input[name="direction"]')!.getAttribute("value")
    ).toBe("asc");
    expect(view.getByRole("button", { name: "Apply filters" })).toBeDefined();
    expect(view.getByRole("link", { name: "Clear" })).toBeDefined();
  });

  test("builds shortcut links that keep sorting and omit the page", async () => {
    const originalNow = Temporal.Now.instant;
    Temporal.Now.instant = () => Temporal.Instant.from("2026-08-12T10:00:00Z");
    customerPage = {
      input: { direction: "asc", page: 3, sort: "activity" },
      result: defaultCustomersPage.result,
    };

    try {
      const { CustomersAdministrationContent } = await import("./page");
      const view = render(
        await CustomersAdministrationContent({
          searchParams: Promise.resolve({}),
        })
      );
      const shortcuts = view.getByRole("navigation", {
        name: "Customer date shortcuts",
      });
      const shortcutLinks = within(shortcuts).getAllByRole("link");

      expect(shortcutLinks.map((link) => link.textContent)).toEqual([
        "Today",
        "Upcoming",
        "Past",
      ]);
      expect(shortcutLinks.map((link) => link.getAttribute("href"))).toEqual([
        "/admin/customers?direction=asc&from=2026-08-12&sort=activity&to=2026-08-12",
        "/admin/customers?direction=asc&from=2026-08-13&sort=activity",
        "/admin/customers?direction=asc&sort=activity&to=2026-08-11",
      ]);
    } finally {
      Temporal.Now.instant = originalNow;
    }
  });

  test("clears the date range without extra parameters", async () => {
    customerPage = {
      input: {
        direction: "desc",
        from: "2026-08-04",
        sort: "activity",
        to: "2026-08-10",
      },
      result: defaultCustomersPage.result,
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
      "/admin/customers"
    );
  });

  test("keeps an unavailable date filter distinct from a genuine empty result", async () => {
    customerPage = {
      input: { from: "2026-08-04", to: "2026-08-10" },
      result: {
        ...defaultCustomersPage.result,
        dateFilterUnavailable: true,
        total: 0,
      },
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(
      view.getByText(
        "Booking dates are temporarily unavailable. Try this date range again shortly."
      )
    ).toBeDefined();
    expect(view.queryByLabelText("0 customers")).toBeNull();
    expect(view.queryByText("No customers have reservations yet.")).toBeNull();
    expect(view.queryByRole("table", { name: "Customers" })).toBeNull();
    expect(view.getByLabelText("Start date from").getAttribute("value")).toBe(
      "2026-08-04"
    );
    expect(view.getByLabelText("Start date to").getAttribute("value")).toBe(
      "2026-08-10"
    );
    expect(view.getByRole("button", { name: "Apply filters" })).toBeDefined();
    expect(view.getByRole("link", { name: "Clear" })).toBeDefined();
    expect(
      within(
        view.getByRole("navigation", { name: "Customer date shortcuts" })
      ).getAllByRole("link")
    ).toHaveLength(3);
  });

  test("keeps a genuine empty date match as the ordinary empty state", async () => {
    customerPage = {
      input: { from: "2026-08-04", to: "2026-08-10" },
      result: {
        ...defaultCustomersPage.result,
        dateFilterUnavailable: false,
        total: 0,
      },
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    expect(view.getByLabelText("0 customers").textContent).toBe("0");
    expect(view.getByText("No customers have reservations yet.")).toBeDefined();
    expect(
      view.queryByText(
        "Booking dates are temporarily unavailable. Try this date range again shortly."
      )
    ).toBeNull();
  });

  test("the streamed customer collection does not turn provider failure into an empty list", async () => {
    const { CustomersTable } = await import("./page");
    const collection = await CustomersTable({
      input: Promise.resolve({
        direction: "desc",
        from: "2026-08-04",
        page: 1,
        sort: "activity",
        to: "2026-08-10",
      }),
      result: Promise.resolve({
        ...defaultCustomersPage.result,
        dateFilterUnavailable: true,
        total: 0,
      }),
    });
    const view = render(collection);

    expect(
      view.getByText(
        "Booking dates are temporarily unavailable. Try this date range again shortly."
      )
    ).toBeDefined();
    expect(view.queryByText("No customers have reservations yet.")).toBeNull();
    expect(view.queryByRole("table", { name: "Customers" })).toBeNull();
    expect(view.queryByRole("link", { name: "Next" })).toBeNull();
  });

  test("the streamed customer count is absent when booking dates are unavailable", async () => {
    customerPage = {
      input: { from: "2026-08-04", to: "2026-08-10" },
      result: {
        ...defaultCustomersPage.result,
        dateFilterUnavailable: true,
        total: 0,
      },
    };
    const { default: DiscountCustomersAdminPage } = await import("./page");
    const page = DiscountCustomersAdminPage({
      searchParams: Promise.resolve({}),
    }) as ReactElement<{ readonly children: ReactNode }>;
    const toolbar = Children.toArray(page.props.children).find(
      (child): child is ReactElement<{ readonly count: ReactNode }> =>
        isValidElement(child) && child.type === AdministrationTableToolbar
    );
    expect(toolbar).toBeDefined();

    const countSuspense = toolbar!.props.count as ReactElement<{
      readonly children: ReactNode;
    }>;
    const countComponent = Children.only(
      countSuspense.props.children
    ) as ReactElement<{
      readonly result: Promise<LoadedCustomersPage["result"]>;
    }>;
    const countContent = await (
      countComponent.type as (
        props: typeof countComponent.props
      ) => Promise<ReactNode>
    )(countComponent.props);
    const view = render(countContent);

    expect(view.queryByLabelText("0 customers")).toBeNull();
  });

  test("preserves the date range on pagination and sort links", async () => {
    customerPage = {
      input: {
        direction: "asc",
        from: "2026-08-04",
        sort: "activity",
        to: "2026-08-10",
      },
      result: {
        ...defaultCustomersPage.result,
        items: [
          {
            customer: null,
            customerId: "customer-one" as never,
            lastActivityAt: "2026-08-10T08:00:00Z",
            reservationCount: 3,
          },
        ],
        page: 2,
        pageCount: 3,
      },
    };
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({
          direction: "asc",
          from: "2026-08-04",
          page: "2",
          sort: "activity",
          to: "2026-08-10",
        }),
      })
    );

    expect(
      view.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe(
      "/admin/customers?direction=asc&from=2026-08-04&sort=activity&to=2026-08-10"
    );
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/admin/customers?direction=asc&from=2026-08-04&sort=activity&to=2026-08-10&page=3"
    );
    const table = view.getByRole("table", { name: "Customers" });
    const sortLink = within(table).getByRole("link", { name: "Reservations" });
    expect(sortLink.getAttribute("href")).toBe(
      "/admin/customers?direction=asc&from=2026-08-04&sort=reservations&to=2026-08-10"
    );
  });

  test("keeps contact values out of rendered URLs", async () => {
    const { CustomersAdministrationContent } = await import("./page");
    const view = render(
      await CustomersAdministrationContent({
        searchParams: Promise.resolve({}),
      })
    );

    const hrefs = [...view.baseElement.querySelectorAll("a[href]")].map(
      (link) => link.getAttribute("href")
    );
    for (const href of hrefs) {
      expect(href).not.toMatch(/[?&](name|email|phone|q|query|search)=/i);
    }
  });
});
