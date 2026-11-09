import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "./data-table";
import { m } from "./i18n";

type Desk = { readonly id: string; readonly name: string };

const desks: readonly Desk[] = [
  { id: "a", name: "Window desk" },
  { id: "b", name: "Quiet desk" },
];

const deskColumns: readonly AdministrationDataTableColumn<Desk>[] = [
  { accessorKey: "name", header: "Name" },
];

const bodyRows = (table: HTMLElement) =>
  within(table).getAllByRole("row").slice(1);

describe("AdministrationDataTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("orders numbered text naturally and keeps one sort applied", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Codes"
        columns={[{ accessorKey: "code", header: "Code" }]}
        data={[
          { id: "10", code: "Code 10" },
          { id: "2", code: "Code 2" },
          { id: "1", code: "Code 1" },
        ]}
        getRowId={(item) => item.id}
      />
    );
    const table = view.getByRole("table", { name: "Codes" });
    const sort = within(table).getByRole("button", { name: "Code" });
    const codes = () =>
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent);

    fireEvent.click(sort);
    expect(codes()).toEqual(["Code 1", "Code 2", "Code 10"]);

    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(codes()).toEqual(["Code 10", "Code 2", "Code 1"]);

    fireEvent.click(sort);
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
  });

  test("activates a row from a click outside its controls", () => {
    const activations: [string, boolean][] = [];
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        columns={deskColumns}
        data={desks}
        expandedId="b"
        getRowId={(item) => item.id}
        onRowActivate={(item, expanded) =>
          activations.push([item.id, expanded])
        }
        renderActions={(item) => (
          <button type="button">{`Open ${item.name}`}</button>
        )}
      />
    );
    const [first, second] = bodyRows(view.getByRole("table"));
    if (!(first && second)) throw new Error("Expected two desk rows.");

    expect(first.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(within(first).getByText("Window desk"));
    fireEvent.click(within(second).getByText("Quiet desk"));
    fireEvent.click(within(first).getByRole("button"));
    expect(activations).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  test("activates a focused row with Enter or Space only", () => {
    const activations: string[] = [];
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        columns={deskColumns}
        data={desks}
        getRowId={(item) => item.id}
        onRowActivate={(item) => activations.push(item.id)}
      />
    );
    const [first] = bodyRows(view.getByRole("table"));
    if (!first) throw new Error("Expected a desk row.");

    const enter = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    first.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    fireEvent.keyDown(first, { key: " " });
    fireEvent.keyDown(first, { key: "Escape" });
    fireEvent.keyDown(within(first).getByText("Window desk"), {
      key: "Enter",
    });
    expect(activations).toEqual(["a", "a"]);
  });

  test("leaves rows the table refuses to activate inert", () => {
    const activations: string[] = [];
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        canRowActivate={(item) => item.id === "a"}
        columns={deskColumns}
        data={desks}
        getRowId={(item) => item.id}
        onRowActivate={(item) => activations.push(item.id)}
      />
    );
    const [, second] = bodyRows(view.getByRole("table"));
    if (!second) throw new Error("Expected two desk rows.");

    expect(second.hasAttribute("tabindex")).toBe(false);
    expect(second.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(within(second).getByText("Quiet desk"));
    fireEvent.keyDown(second, { key: "Enter" });
    expect(activations).toEqual([]);
  });

  test("leaves every row inert without an activation handler", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        columns={deskColumns}
        data={desks}
        getRowId={(item) => item.id}
      />
    );
    for (const row of bodyRows(view.getByRole("table"))) {
      expect(row.hasAttribute("tabindex")).toBe(false);
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });
    }
  });

  test("shows the expanded row's detail across every column", () => {
    const view = render(
      <AdministrationDataTable
        actionsLabel="Manage"
        ariaLabel="Desks"
        columns={deskColumns}
        data={desks}
        expandedId="a"
        getRowId={(item) => item.id}
        renderActions={(item, expanded) =>
          `${item.id}:${expanded ? "open" : "closed"}`
        }
        renderExpanded={(item) => <p>{`Detail ${item.id}`}</p>}
      />
    );
    const table = view.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: "Manage" })
    ).toBeTruthy();
    const rows = bodyRows(table);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.lastElementChild?.textContent).toBe("a:open");
    const detail = within(table).getByText("Detail a").closest("td");
    expect(detail?.getAttribute("colspan")).toBe("2");
    expect(rows[2]?.lastElementChild?.textContent).toBe("b:closed");
    expect(within(table).queryByText("Detail b")).toBeNull();
  });

  test("names the actions column by default and spans only the data columns without actions", () => {
    const withActions = render(
      <RouteLocaleProvider locale="en-US">
        <AdministrationDataTable
          ariaLabel="With actions"
          columns={deskColumns}
          data={desks}
          getRowId={(item) => item.id}
          renderActions={() => null}
        />
      </RouteLocaleProvider>
    );
    expect(
      within(withActions.getByRole("table")).getByRole("columnheader", {
        name: m.administrationTableActions({}, { locale: "en-US" }),
      })
    ).toBeTruthy();
    cleanup();

    const withoutActions = render(
      <AdministrationDataTable
        ariaLabel="Without actions"
        columns={deskColumns}
        data={desks}
        expandedId="b"
        getRowId={(item) => item.id}
        renderExpanded={(item) => `Detail ${item.id}`}
      />
    );
    const table = withoutActions.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(1);
    expect(
      within(table).getByText("Detail b").closest("td")?.getAttribute("colspan")
    ).toBe("1");
  });

  test("links sortable headers to the server-sorted page in the other direction", () => {
    const requested: [string, string][] = [];
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        columns={[
          { accessorKey: "name", header: "Name" },
          { accessorKey: "id", enableSorting: false, header: "Code" },
        ]}
        data={desks}
        getRowId={(item) => item.id}
        getSortHref={(columnId, direction) => {
          requested.push([columnId, direction]);
          return `/admin/desks?sort=${columnId}&direction=${direction}`;
        }}
        sorting={[{ desc: false, id: "name" }]}
      />
    );
    const table = view.getByRole("table");
    const sortLink = within(table).getByRole("link", { name: "Name" });
    expect(sortLink.getAttribute("href")).toContain(
      "/admin/desks?sort=name&direction=desc"
    );
    expect(sortLink.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(within(table).queryByRole("button")).toBeNull();
    expect(requested).toEqual([["name", "desc"]]);
    expect(bodyRows(table).map((row) => row.textContent)).toEqual([
      "Window deska",
      "Quiet deskb",
    ]);
  });

  test("puts a mobile view beside the desktop table when given one", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Desks"
        columns={deskColumns}
        data={desks}
        getRowId={(item) => item.id}
        mobile={<ul aria-label="Desk cards" />}
      />
    );
    expect(view.getByRole("table", { name: "Desks" })).toBeTruthy();
    expect(view.getByRole("list", { name: "Desk cards" })).toBeTruthy();
  });
});
