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

  test("contains expanded rows in a capped container-query wrapper", () => {
    const view = render(
      <AdministrationDataTable
        ariaLabel="Expandable"
        columns={[{ accessorKey: "name", header: "Name" }]}
        data={[{ id: "a", name: "Alpha" }]}
        expandedId="a"
        getRowId={(item) => item.id}
        renderExpanded={(item) => <output>Details for {item.name}</output>}
      />
    );
    const frame = view.container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("@container");

    const expandedCell = view.container.querySelector("output")!.parentElement!;
    expect(expandedCell.className).toContain("min-w-0");
    expect(expandedCell.className).toContain("w-full");
    expect(expandedCell.className).toContain("max-w-[calc(100cqw-2.5rem)]");
    expect(frame.contains(expandedCell)).toBe(true);
  });
});
