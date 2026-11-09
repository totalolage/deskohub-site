import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { Table } from "@deskohub/dotypos/generated";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { DotyposTablesPreview } = await import("./dotypos-tables-preview");

const windowTable: Table = {
  _cloudId: "cloud",
  id: "table-1",
  name: "Window",
  type: "CIRCLE2",
  locationName: "Ground floor",
  seats: "4",
  positionX: "10",
  positionY: "20",
  rotation: "90",
};
const closedTable: Table = {
  _cloudId: "cloud",
  id: "table-2",
  name: "Closed",
  positionX: "120",
  positionY: "20",
  enabled: false,
};
const hiddenTable: Table = {
  _cloudId: "cloud",
  id: "table-3",
  name: "Hidden",
  positionX: "240",
  positionY: "20",
  display: false,
};
/** A table Dotypos returns without placement. */
const bareTable: Table = { _cloudId: "cloud", id: "table-4", name: "Bare" };

const shapeClassOf = (view: ReturnType<typeof render>, name: string) =>
  view
    .getByRole("button", { name })
    .querySelector("[class]")
    ?.getAttribute("class");

/** The selected table's facts in display order. */
const selectedFacts = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("aside dd")].map(
    (fact) => fact.textContent
  );

describe("DotyposTablesPreview", () => {
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("selects the first table and shades the rest by availability", () => {
    const view = render(
      <DotyposTablesPreview
        tables={[windowTable, closedTable, hiddenTable, bareTable]}
      />
    );

    expect(shapeClassOf(view, "Window")).toContain("fill-amber-300");
    expect(shapeClassOf(view, "Closed")).toContain("fill-stone-200");
    expect(shapeClassOf(view, "Hidden")).toContain("fill-stone-200");
    expect(shapeClassOf(view, "Bare")).toContain("fill-emerald-300");
    expect(selectedFacts(view).slice(0, 7)).toEqual([
      "Window",
      "table-1",
      "CIRCLE2",
      "Ground floor",
      "4",
      "10, 20",
      "90",
    ]);
  });

  test("moves the selection to a clicked table", () => {
    const view = render(
      <DotyposTablesPreview tables={[windowTable, bareTable]} />
    );

    fireEvent.click(view.getByRole("button", { name: "Bare" }));

    expect(shapeClassOf(view, "Bare")).toContain("fill-amber-300");
    expect(shapeClassOf(view, "Window")).toContain("fill-emerald-300");
    expect(selectedFacts(view).slice(0, 7)).toEqual([
      "Bare",
      "table-4",
      "GENERIC",
      "-",
      "-",
      "0, 0",
      "0",
    ]);
  });

  test("tells hidden and disabled tables apart from offered ones", () => {
    const view = render(
      <DotyposTablesPreview tables={[windowTable, closedTable, hiddenTable]} />
    );
    const offered = selectedFacts(view).slice(7);
    fireEvent.click(view.getByRole("button", { name: "Closed" }));
    const closed = selectedFacts(view).slice(7);
    fireEvent.click(view.getByRole("button", { name: "Hidden" }));
    const hidden = selectedFacts(view).slice(7);

    expect(offered[0]).toBe(offered[1]);
    expect(closed[0]).toBe(offered[0]);
    expect(closed[1]).not.toBe(offered[1]);
    expect(hidden[0]).not.toBe(offered[0]);
    expect(hidden[1]).toBe(offered[1]);
  });

  test("shows no facts when Dotypos returns no tables", () => {
    const view = render(<DotyposTablesPreview tables={[]} />);
    const aside = view.container.querySelector("aside");

    expect(aside?.querySelector("dl")).toBeNull();
    expect(within(aside as HTMLElement).getByRole("paragraph")).toBeDefined();
  });
});
