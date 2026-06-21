import { describe, expect, test } from "bun:test";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { getWorkspaceTableMap } from "./workspace-table-map";

const makeReservation = (tableId: string): Reservation =>
  ({ _tableId: tableId }) as Reservation;

const makeTable = (input: Partial<Table> & Pick<Table, "id" | "name">): Table =>
  ({
    _cloudId: "cloud",
    display: true,
    enabled: true,
    locationName: "main",
    tags: ["tier:basic"],
    ...input,
  }) as Table;

describe("getWorkspaceTableMap", () => {
  test("returns only displayable workspace tables from the assigned room", () => {
    const tableMap = getWorkspaceTableMap(makeReservation("assigned"), [
      makeTable({ id: "assigned", name: "1" }),
      makeTable({ id: "plus", name: "2", tags: ["tier:plus"] }),
      makeTable({ id: "hidden", name: "3", display: false }),
      makeTable({ id: "disabled", name: "4", enabled: false }),
      makeTable({ id: "virtual", name: "5", tags: ["not-workspace"] }),
      makeTable({ id: "other-room", name: "6", locationName: "side" }),
    ]);

    expect(tableMap?.tables.map((table) => table.id)).toEqual([
      "assigned",
      "plus",
    ]);
  });
});
