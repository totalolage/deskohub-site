import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { m } from "./i18n";

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
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

  test.each([
    {
      filterLayout: "inline",
      // One wrapping row: the count group fills the line at the controls'
      // height, so the count stays centred beside them, and the controls
      // keep to the right.
      row: { has: ["flex", "flex-wrap"], lacks: ["grid"] },
      count: { has: ["flex-auto", "min-h-10"], lacks: [] },
      controls: { has: ["ml-auto", "flex-wrap"], lacks: ["flex-col"] },
    },
    {
      filterLayout: "stacked",
      // A grid that puts the controls on their own row below the count until
      // the 2xl breakpoint.
      row: { has: ["grid"], lacks: ["flex-wrap"] },
      count: { has: [], lacks: ["flex-auto", "min-h-10"] },
      controls: { has: ["flex-col"], lacks: ["ml-auto"] },
    },
  ] as const)(
    "lays out $filterLayout filters with the actions after them",
    async ({ count, controls, filterLayout, row }) => {
      const { AdministrationTableToolbar } = await import("./table-toolbar");
      const view = render(
        <RouteLocaleProvider locale="en-US">
          <AdministrationTableToolbar
            actions={<a href="/en-US/admin/email-campaigns/new">New</a>}
            count={<output aria-label="Count" />}
            filterLayout={filterLayout}
            filters={<form aria-label="Filters" />}
            label="Table controls"
          />
        </RouteLocaleProvider>
      );
      const rowElement = view.getByRole("region", {
        name: "Table controls",
      }).firstElementChild as HTMLElement;
      const [countGroup, controlsGroup] = rowElement.children;
      const expectClasses = (
        element: Element | undefined,
        classes: {
          readonly has: readonly string[];
          readonly lacks: readonly string[];
        }
      ) => {
        const tokens = [...(element?.classList ?? [])];
        expect(tokens).toEqual(expect.arrayContaining([...classes.has]));
        for (const token of classes.lacks) expect(tokens).not.toContain(token);
      };

      expect(rowElement.children).toHaveLength(2);
      expectClasses(rowElement, row);
      expectClasses(countGroup, count);
      expectClasses(controlsGroup, controls);
      expect(countGroup?.contains(view.getByLabelText("Count"))).toBe(true);
      const filters = view.getByRole("form", { name: "Filters" });
      const action = view.getByRole("link");
      expect(controlsGroup?.firstElementChild).toBe(filters);
      expect(controlsGroup?.lastElementChild?.contains(action)).toBe(true);
      expect(filters.contains(action)).toBe(false);
    }
  );

  test("keeps the count beside the actions when a list has no filters", async () => {
    const { AdministrationTableToolbar } = await import("./table-toolbar");
    const view = render(
      <RouteLocaleProvider locale="en-US">
        <AdministrationTableToolbar
          actions={<a href="/en-US/admin/discounts/new">New</a>}
          count={null}
          filterLayout="inline"
          label="Table controls"
        />
      </RouteLocaleProvider>
    );
    const rowElement = view.getByRole("region", {
      name: "Table controls",
    }).firstElementChild;

    expect([...(rowElement?.classList ?? [])]).toEqual(
      expect.arrayContaining(["grid", "grid-cols-[minmax(0,1fr)_auto]"])
    );
    expect(rowElement?.lastElementChild?.contains(view.getByRole("link"))).toBe(
      true
    );
  });

  test("shows a failed export below the controls until the next attempt", async () => {
    const unavailable = () =>
      Response.json(
        { code: "administration_list_source_unavailable", error: "x" },
        { status: 503 }
      );
    globalThis.fetch = (async () => unavailable()) as typeof fetch;
    const { AdministrationTableToolbar } = await import("./table-toolbar");
    const view = await act(async () =>
      render(
        <RouteLocaleProvider locale="en-US">
          <AdministrationTableToolbar
            count={null}
            exportHref={Promise.resolve("/admin/customers/export")}
            filters={<div>Filters</div>}
            label="Customer table controls"
            search={<input aria-label="Search" />}
          />
        </RouteLocaleProvider>
      )
    );
    const region = view.getByRole("region", {
      name: "Customer table controls",
    });
    const alert = within(region).getByRole("alert");
    const link = await within(region).findByRole("link", {
      name: m.administrationListExportButton({}, { locale: "en-US" }),
    });
    const controls = region.firstElementChild;

    fireEvent.click(link);

    await waitFor(() => expect(alert.textContent).not.toBe(""));
    expect(controls?.contains(link)).toBe(true);
    expect(controls?.contains(view.getByLabelText("Search"))).toBe(true);
    expect(controls?.contains(alert)).toBe(false);
    expect(region.lastElementChild).toBe(alert);

    let finish!: () => void;
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        finish = () => resolve(unavailable());
      })) as typeof fetch;
    fireEvent.click(link);

    await waitFor(() =>
      expect(link.getAttribute("aria-disabled")).toBe("true")
    );
    expect(alert.textContent).toBe("");
    finish();
    await waitFor(() => expect(alert.textContent).not.toBe(""));
    expect(within(region).getByRole("alert")).toBe(alert);
  });
});
