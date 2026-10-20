import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { act, cleanup, render, within } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { m } from "./i18n";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("AdministrationTableCount", () => {
  test.each([
    ["en-US", "1,000"],
    ["cs-CZ", "1 000"],
  ] as const)("groups the digits of a %s count", async (locale, text) => {
    const { AdministrationTableCount } = await import("./table-toolbar");
    const view = render(
      <RouteLocaleProvider locale={locale}>
        <AdministrationTableCount count={1000} label="1000 rows" />
      </RouteLocaleProvider>
    );

    expect(view.getByLabelText("1000 rows").textContent).toBe(text);
  });
});

describe("AdministrationTableToolbar", () => {
  test("offers the CSV export only when given an export path", async () => {
    const { AdministrationTableToolbar } = await import("./table-toolbar");
    const exportLabel = m.administrationListExportButton(
      {},
      { locale: "cs-CZ" }
    );
    // The export path arrives as a promise, so let React settle the Suspense.
    const view = await act(async () =>
      render(
        <RouteLocaleProvider locale="cs-CZ">
          <AdministrationTableToolbar count={null} label="Without export" />
          <AdministrationTableToolbar
            count={null}
            exportHref={Promise.resolve(
              "/admin/reservations/export?type=office"
            )}
            label="With export"
          />
        </RouteLocaleProvider>
      )
    );

    const link = await within(
      view.getByRole("region", { name: "With export" })
    ).findByRole("link", { name: exportLabel });
    expect(link.getAttribute("href")).toBe(
      "/cs-CZ/admin/reservations/export?type=office"
    );
    expect(
      within(view.getByRole("region", { name: "Without export" })).queryByText(
        exportLabel
      )
    ).toBeNull();
  });
});
