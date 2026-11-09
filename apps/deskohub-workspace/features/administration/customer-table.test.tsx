import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomerSummary } from "./administration.service";
import { customerListQuery } from "./customer-list-query";
import { AdministrationCustomerTable } from "./customer-table";
import { formatAdministrationDateTime } from "./formatters";

const customerSummary = (
  id: string,
  reservationCount: number,
  marketingConsent: AdministrationCustomerSummary["marketingConsent"] = "absent"
): AdministrationCustomerSummary => ({
  customer: null,
  customerId: id as AdministrationCustomerSummary["customerId"],
  lastActivityAt: "2026-08-14T12:00:00Z",
  marketingConsent,
  reservationCount,
});

describe("AdministrationCustomerTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders headings, counts and fallbacks in Czech", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <AdministrationCustomerTable
          customers={[customerSummary("one", 3), customerSummary("two", 5)]}
        />
      </RouteLocaleProvider>
    );

    expect(view.getByRole("columnheader", { name: "Jméno" })).toBeDefined();
    expect(
      view.getByRole("columnheader", { name: "Poslední aktivita" })
    ).toBeDefined();
    expect(
      view.getAllByText("Údaje nejsou k dispozici").length
    ).toBeGreaterThan(0);
    expect(
      view.getAllByText(
        (_, element) =>
          element?.tagName === "TD" && element.textContent === "3 rezervace"
      )
    ).toHaveLength(1);
    expect(
      view.getAllByText(
        (_, element) =>
          element?.tagName === "TD" && element.textContent === "5 rezervací"
      )
    ).toHaveLength(1);
    expect(
      view.getByText(
        `5 rezervací · Aktualizováno ${formatAdministrationDateTime("2026-08-14T12:00:00Z", "cs-CZ")}`
      )
    ).toBeDefined();
  });

  test("groups the digits of a large reservation count for the locale", () => {
    for (const [locale, text] of [
      ["cs-CZ", "1\u00a0234 rezervací"],
      ["en-US", "1,234 reservations"],
    ] as const) {
      const view = render(
        <RouteLocaleProvider locale={locale}>
          <AdministrationCustomerTable
            customers={[customerSummary("many", 1234)]}
          />
        </RouteLocaleProvider>
      );

      expect(
        view.getAllByText(
          (_, element) =>
            element?.tagName === "TD" && element.textContent === text
        )
      ).toHaveLength(1);
      view.unmount();
    }
  });

  test("shows each customer's marketing consent state on desktop and mobile", () => {
    const view = render(
      <RouteLocaleProvider locale="en-US">
        <AdministrationCustomerTable
          customers={[
            customerSummary("active", 1, "active"),
            customerSummary("withdrawn", 1, "withdrawn"),
            customerSummary("absent", 1, "absent"),
          ]}
        />
      </RouteLocaleProvider>
    );

    expect(
      view.getByRole("columnheader", { name: "Marketing consent" })
    ).toBeDefined();
    const table = view.getByRole("table");
    const mobileList = view.getByRole("list");
    for (const label of ["Granted", "Withdrawn", "Never granted"]) {
      expect(within(table).getAllByText(label)).toHaveLength(1);
      expect(within(mobileList).getAllByText(label)).toHaveLength(1);
    }
    expect(within(mobileList).getAllByText("Marketing consent")).toHaveLength(
      3
    );
  });

  test("keeps the list's filters in sort links", () => {
    const view = render(
      <RouteLocaleProvider locale="en-US">
        <AdministrationCustomerTable
          customers={[customerSummary("one", 1)]}
          query={customerListQuery.parse({
            from: "2026-10-01",
            marketingConsent: "active",
            to: "2026-10-31",
          })}
        />
      </RouteLocaleProvider>
    );

    const href = view
      .getByRole("link", { name: /Reservations/ })
      .getAttribute("href");
    const search = new URL(href ?? "", "https://admin.test").searchParams;
    expect(Object.fromEntries(search)).toEqual({
      direction: "asc",
      from: "2026-10-01",
      marketingConsent: "active",
      sort: "reservations",
      to: "2026-10-31",
    });
  });

  test("explains an empty filtered list", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <AdministrationCustomerTable customers={[]} filtered />
      </RouteLocaleProvider>
    );

    expect(
      view.getByText("Těmto filtrům neodpovídá žádný zákazník.")
    ).toBeDefined();
  });

  test("explains an empty list in Czech", () => {
    const view = render(
      <RouteLocaleProvider locale="cs-CZ">
        <AdministrationCustomerTable customers={[]} />
      </RouteLocaleProvider>
    );

    expect(
      view.getByText("Zatím žádný zákazník nemá rezervaci.")
    ).toBeDefined();
  });
});
