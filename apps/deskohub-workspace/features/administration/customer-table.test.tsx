import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AdministrationCustomerSummary } from "./administration.service";
import { AdministrationCustomerTable } from "./customer-table";
import { formatAdministrationDateTime } from "./formatters";

const customerSummary = (
  id: string,
  reservationCount: number
): AdministrationCustomerSummary => ({
  customer: null,
  customerId: id as AdministrationCustomerSummary["customerId"],
  lastActivityAt: "2026-08-14T12:00:00Z",
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
