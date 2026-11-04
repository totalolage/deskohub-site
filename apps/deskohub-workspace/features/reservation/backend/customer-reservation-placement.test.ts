import { describe, expect, test } from "bun:test";
import { type DotyposTable, DotyposTableIdSchema } from "@deskohub/dotypos";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { getCustomerReservationPlacement } from "./customer-reservation-placement";

const openSpace: StoredWorkspaceReservationDetails = {
  kind: "cowork",
  entryTier: "open-space",
  coffee: false,
};

const reservedDesk: StoredWorkspaceReservationDetails = {
  kind: "cowork",
  entryTier: "reserved-desk",
  coffee: true,
  monitorOption: "2x27-qhd",
};

const makeTable = (
  overrides: Partial<Omit<DotyposTable, "id">> & { readonly id?: string } = {}
): DotyposTable =>
  ({
    _cloudId: "cloud",
    id: "assigned-table",
    name: "12",
    display: true,
    enabled: true,
    locationName: "Main room",
    seats: "1",
    tags: ["cowork:reserved-desk"],
    ...overrides,
  }) as DotyposTable;

const assignedTo = (tableId: string) => ({
  _tableId: DotyposTableIdSchema.make(tableId),
});

const place = (input: {
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly tables: readonly DotyposTable[];
  readonly tableId?: string;
  readonly seatingMap?: boolean;
}) =>
  getCustomerReservationPlacement({
    reservationDetails: input.reservationDetails,
    dotyposReservation:
      input.tableId === undefined ? {} : assignedTo(input.tableId),
    tables: input.tables,
    seatingMap: input.seatingMap ?? false,
  });

describe("getCustomerReservationPlacement", () => {
  test("names the assigned table for every product except Open Space", () => {
    const assignedProducts = [
      reservedDesk,
      { kind: "cowork", entryTier: "basic", coffee: false },
      { kind: "cowork", entryTier: "plus", coffee: true },
      {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      { kind: "meeting-room" },
      { kind: "office" },
    ] satisfies readonly StoredWorkspaceReservationDetails[];

    for (const reservationDetails of assignedProducts) {
      expect(
        place({
          reservationDetails,
          tables: [makeTable({ name: "  12  " })],
          tableId: "assigned-table",
        })
      ).toEqual({ table: { mode: "assigned", name: "12" } });
    }
  });

  test("falls back to the assigned table's ID when it has no name", () => {
    expect(
      place({
        reservationDetails: reservedDesk,
        tables: [makeTable({ name: "   " })],
        tableId: "assigned-table",
      })
    ).toEqual({ table: { mode: "assigned", name: "assigned-table" } });
    expect(
      place({
        reservationDetails: reservedDesk,
        tables: [],
        tableId: "missing-table",
      })
    ).toEqual({ table: { mode: "assigned", name: "missing-table" } });
  });

  test("has no table when Dotypos assigned none", () => {
    expect(
      place({ reservationDetails: reservedDesk, tables: [makeTable()] })
    ).toEqual({});
  });

  test("lists named, assignable Open Space tables with valid capacity", () => {
    const placement = place({
      reservationDetails: openSpace,
      tableId: "assigned-table",
      tables: [
        makeTable({
          name: "  Assigned desk  ",
          seats: "2",
          tags: ["cowork:open-space"],
        }),
        makeTable({
          id: "free-table",
          name: " Free desk ",
          seats: "4",
          tags: ["cowork:open-space"],
        }),
        makeTable({
          id: "disabled-table",
          name: "Disabled desk",
          enabled: false,
          tags: ["cowork:open-space"],
        }),
        makeTable({
          id: "undisplayed-table",
          name: "Undisplayed desk",
          display: false,
          tags: ["cowork:open-space"],
        }),
        makeTable({ id: "reserved-desk", name: "Reserved desk" }),
        makeTable({
          id: "historical-table",
          name: "Historical desk",
          tags: ["tier:basic"],
        }),
        makeTable({
          id: "monitor-table",
          name: "Monitor desk",
          tags: ["cowork:open-space", "monitor:size:27"],
        }),
        ...["", "0", "-1", "1.5", "not-a-number"].map((seats) =>
          makeTable({
            id: `capacity-${seats}`,
            name: `Capacity ${seats} desk`,
            seats,
            tags: ["cowork:open-space"],
          })
        ),
        makeTable({
          id: "missing-capacity",
          name: "Missing capacity desk",
          seats: undefined,
          tags: ["cowork:open-space"],
        }),
        makeTable({
          id: "unnamed-table",
          name: "   ",
          tags: ["cowork:open-space"],
        }),
      ],
    });

    expect(placement).toEqual({
      table: { mode: "shared", name: "Assigned desk, Free desk" },
    });
  });

  test("compacts numeric Open Space names into ranges", () => {
    const names = ["12", "wallee", "9", "16", "10", "15", "11", "gromice"];

    expect(
      place({
        reservationDetails: openSpace,
        tableId: "open-9",
        tables: names.map((name) =>
          makeTable({ id: `open-${name}`, name, tags: ["cowork:open-space"] })
        ),
      }).table
    ).toEqual({ mode: "shared", name: "9-12, 15, 16, wallee, gromice" });
  });

  test("never names an Open Space reservation's assigned table, even by ID", () => {
    const placement = place({
      reservationDetails: openSpace,
      tableId: "assigned-only-sentinel",
      tables: [
        makeTable({
          id: "assigned-only-sentinel",
          name: "   ",
          tags: ["cowork:open-space"],
        }),
        makeTable({ id: "reserved-desk", name: "Reserved desk" }),
      ],
    });

    expect(placement).toEqual({});
  });

  test("shows the assigned table's room only once the seating map is released", () => {
    const tables = [
      makeTable(),
      makeTable({ id: "neighbor-table", name: "11" }),
      makeTable({
        id: "quiet-table",
        name: "1",
        locationName: "Quiet room",
      }),
    ];

    const released = place({
      reservationDetails: reservedDesk,
      tables,
      tableId: "assigned-table",
      seatingMap: true,
    });
    expect(released.tableMap).toMatchObject({
      assignedTableId: "assigned-table",
      roomName: "Main room",
    });
    expect(released.tableMap?.tables.map((table) => table.id)).toEqual([
      "assigned-table",
      "neighbor-table",
    ]);

    expect(
      place({
        reservationDetails: reservedDesk,
        tables,
        tableId: "assigned-table",
        seatingMap: false,
      }).tableMap
    ).toBeUndefined();
  });

  test("keeps the Open Space seating map beside the shared tables", () => {
    const placement = place({
      reservationDetails: openSpace,
      tableId: "assigned-table",
      tables: [makeTable({ name: "9", tags: ["cowork:open-space"] })],
      seatingMap: true,
    });

    expect(placement.table).toEqual({ mode: "shared", name: "9" });
    expect(placement.tableMap?.assignedTableId).toBe(
      DotyposTableIdSchema.make("assigned-table")
    );
  });
});
