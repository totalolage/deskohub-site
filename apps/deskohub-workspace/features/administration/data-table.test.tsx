import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { AdministrationDataTable } from "./data-table";

describe("AdministrationDataTable", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("sorts rows through the shared accessible headers", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Example"
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={[
          { id: "b", name: "Beta" },
          { id: "a", name: "Alpha" },
        ]}
        getRowId={(item) => item.id}
      />
    );
    const table = view.getByRole("table", { name: "Example" });
    const sort = within(table).getByRole("button", { name: "Name" });

    fireEvent.click(sort);

    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("ascending");
    expect(within(table).getAllByRole("row")[1]?.textContent).toBe("Alpha");
  });

  test("orders numbered text naturally and keeps one sort applied", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Codes"
        columns={[
          {
            accessorKey: "code",
            header: "Code",
            meta: { cellClassName: "font-mono", headClassName: "w-32" },
          },
        ]}
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
    expect(sort.closest("th")?.className).toContain("w-32");
    expect(within(table).getByText("Code 1").className).toContain("font-mono");
  });

  test("links server-sorted headers instead of sorting rows locally", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Server sorted"
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={[
          { id: "b", name: "Beta" },
          { id: "a", name: "Alpha" },
        ]}
        getRowId={(item) => item.id}
        getSortHref={(field, direction) =>
          `/admin?sort=${field}&direction=${direction}`
        }
        sorting={[{ id: "name", desc: true }]}
      />
    );
    const table = view.getByRole("table", { name: "Server sorted" });
    const sort = within(table).getByRole("link", { name: "Name" });

    expect(sort.getAttribute("href")).toBe("/admin?sort=name&direction=asc");
    expect(sort.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent)
    ).toEqual(["Beta", "Alpha"]);
  });
});
