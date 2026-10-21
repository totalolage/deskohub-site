import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { within } from "@testing-library/react";
import { prerender } from "react-dom/static";
import type {
  AdministrationCustomerListInput,
  AdministrationCustomerSummary,
} from "@/features/administration/administration.service";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ connection: () => Promise.resolve() }));
let routeLocale: "cs-CZ" | "en-US" = "en-US";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve(routeLocale),
}));

type LoadedCustomerPage = {
  readonly input: AdministrationCustomerListInput;
  readonly result: {
    readonly dateFilterUnavailable: boolean;
    readonly items: readonly AdministrationCustomerSummary[];
    readonly page: number;
    readonly pageCount: number;
    readonly total: number;
  };
};

const defaultCustomerPage: LoadedCustomerPage = {
  input: { direction: "desc", page: 1, sort: "activity" },
  result: {
    dateFilterUnavailable: false,
    items: [],
    page: 1,
    pageCount: 1,
    total: 0,
  },
};

let customerPage: LoadedCustomerPage = defaultCustomerPage;

mock.module("@/features/administration/page-data.server", () => ({
  loadAdministrationCustomersPage: () => ({
    input: Promise.resolve(customerPage.input),
    result: Promise.resolve(customerPage.result),
  }),
}));

mock.module("@/features/discounts/admin/customer-admin-client", () => ({
  CustomerSearch: () => null,
}));

async function prerenderCustomersPage() {
  const { default: CustomersAdministrationPage } = await import("./page");
  const { prelude } = await prerender(
    <RouteLocaleProvider locale={routeLocale}>
      <CustomersAdministrationPage searchParams={Promise.resolve({})} />
    </RouteLocaleProvider>,
    // Inline every completed boundary instead of streaming hidden segments.
    { progressiveChunkSize: Number.POSITIVE_INFINITY }
  );
  const container = document.createElement("div");
  container.innerHTML = await new Response(prelude).text();
  return within(container);
}

const filteredInput = {
  direction: "asc",
  from: "2026-10-01",
  marketingConsent: "granted",
  page: 2,
  sort: "reservations",
  to: "2026-10-31",
} as const satisfies AdministrationCustomerListInput;

describe("CustomersAdministrationPage", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => {
    customerPage = defaultCustomerPage;
    routeLocale = "en-US";
  });
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps the filters in the form, sort links and pagination", async () => {
    customerPage = {
      input: filteredInput,
      result: {
        dateFilterUnavailable: false,
        items: [
          {
            customer: null,
            customerId:
              "customer-one" as AdministrationCustomerSummary["customerId"],
            lastActivityAt: "2026-10-10T08:00:00Z",
            marketingConsent: "granted",
            reservationCount: 2,
          },
        ],
        page: 2,
        pageCount: 3,
        total: 49,
      },
    };
    const view = await prerenderCustomersPage();

    const form = view
      .getByLabelText("Marketing consent")
      .closest("form") as HTMLFormElement;
    expect(form.getAttribute("action")).toBe("/en-US/admin/customers");
    expect(
      (view.getByLabelText("Reservation start from") as HTMLInputElement).value
    ).toBe("2026-10-01");
    expect(view.getByLabelText("49 customers")).toBeDefined();
    expect(
      view.getByRole("link", { name: "Previous" }).getAttribute("href")
    ).toBe(
      "/en-US/admin/customers?direction=asc&from=2026-10-01&marketingConsent=granted&sort=reservations&to=2026-10-31"
    );
    expect(view.getByRole("link", { name: "Next" }).getAttribute("href")).toBe(
      "/en-US/admin/customers?direction=asc&from=2026-10-01&marketingConsent=granted&sort=reservations&to=2026-10-31&page=3"
    );
    const table = view.getByRole("table", { name: "Customers" });
    expect(
      within(table)
        .getByRole("link", { name: "Last activity" })
        .getAttribute("href")
    ).toBe(
      "/en-US/admin/customers?direction=asc&from=2026-10-01&marketingConsent=granted&sort=activity&to=2026-10-31"
    );
  });

  test("exports the filtered list in its order, without the page", async () => {
    customerPage = {
      input: filteredInput,
      result: { ...defaultCustomerPage.result, page: 2, pageCount: 3 },
    };
    const view = await prerenderCustomersPage();

    expect(
      view.getByRole("link", { name: "Export CSV" }).getAttribute("href")
    ).toBe(
      "/en-US/admin/customers/export?direction=asc&from=2026-10-01&marketingConsent=granted&sort=reservations&to=2026-10-31"
    );
  });

  test("warns in Czech when booking dates can't filter the list", async () => {
    routeLocale = "cs-CZ";
    customerPage = {
      input: filteredInput,
      result: { ...defaultCustomerPage.result, dateFilterUnavailable: true },
    };
    const view = await prerenderCustomersPage();

    expect(
      view.getByText(
        "Data rezervací jsou dočasně nedostupná, proto zákazníky nelze filtrovat podle data rezervace. Zkuste to prosím znovu za chvíli."
      )
    ).toBeDefined();
    // Membership is unknown, so the list claims neither rows nor no matches.
    expect(
      view.queryByText("Těmto filtrům neodpovídá žádný zákazník.")
    ).toBeNull();
    expect(view.queryByText("Zatím žádný zákazník nemá rezervaci.")).toBeNull();
  });

  test("shows no warning for an unfiltered list", async () => {
    const view = await prerenderCustomersPage();

    expect(
      view.queryByText(/Booking dates are temporarily unavailable/)
    ).toBeNull();
    // Only the export control's live region, kept mounted and empty.
    expect(
      view.queryAllByRole("alert").map(({ textContent }) => textContent)
    ).toEqual([""]);
    expect(view.getByText("No customers have reservations yet.")).toBeDefined();
  });
});
