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
});
