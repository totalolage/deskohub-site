import { expect, test } from "bun:test";
import type { Reservation } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import {
  workspaceProductMonitorOptions,
  workspaceProductMonitorOptionTableTags,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceE2ECapacityFailures,
  getWorkspaceE2ECapacityInterval,
  getWorkspaceE2EDateInterval,
  makeWorkspaceE2ECapacityReport,
  makeWorkspaceE2ELegacyTierCleanupCapacityReport,
  workspaceE2ELegacyTierCleanupCapacityGroups,
  workspaceE2EMaximumSameDateCoworkReservations,
} from "./capacity";

test("covers whole Prague dates at both candidate-range boundaries", () => {
  expect(
    getWorkspaceE2ECapacityInterval(new Date("2026-08-04T17:45:00.000Z"))
  ).toEqual({
    endDate: new Date("2026-11-02T23:00:00.000Z"),
    startDate: new Date("2026-08-17T22:00:00.000Z"),
  });
});

test("builds an owned-date interval across Prague's DST boundary", () => {
  expect(
    getWorkspaceE2EDateInterval({
      fromDate: "2026-10-24",
      toDate: "2026-10-25",
    })
  ).toEqual({
    endDate: new Date("2026-10-25T23:00:00.000Z"),
    startDate: new Date("2026-10-23T22:00:00.000Z"),
  });
});

test("keeps the case-plan per-date reservation maximums for the two offers", () => {
  expect(workspaceE2EMaximumSameDateCoworkReservations["open-space"]).toBe(4);
  expect(workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"]).toBe(
    1
  );
});

test("reports only aggregate capacity for every saleable offer pool", () => {
  const openSpaceMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const reservedDeskMaximum =
    workspaceE2EMaximumSameDateCoworkReservations["reserved-desk"];
  const tables: Table[] = [
    makeTable("open-space-table", ["cowork:open-space"], openSpaceMaximum * 8),
    ...Object.entries(workspaceProductMonitorOptionTableTags).map(
      ([monitorOption, tags], index) =>
        makeTable(
          `reserved-desk-${monitorOption}`,
          ["cowork:reserved-desk", ...tags],
          4 + index
        )
    ),
    makeTable("reserved-desk-table", ["cowork:reserved-desk"], 4),
    makeTable("provider-room-id", ["reservation:meeting-room"], 1),
    makeTable("provider-room-2", ["reservation:meeting-room"], 1),
    makeTable("provider-room-3", ["reservation:meeting-room"], 1),
    makeTable("provider-room-headroom", ["reservation:meeting-room"], 1),
    makeTable("provider-office", ["reservation:office"], 8),
    makeTable("hidden-open-space", ["cowork:open-space"], 100, {
      display: false,
    }),
  ];
  const reservations: Reservation[] = [
    makeReservation("open-space-table", 2),
    makeReservation("provider-room-id", 1),
    makeReservation("reserved-desk-table", 1, { status: "CANCELLED" }),
  ];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations,
    tables,
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(
    report.groups
      .map(({ id }) => id)
      .toSorted((left, right) => left.localeCompare(right))
  ).toEqual(
    [
      "open-space",
      "reserved-desk",
      ...workspaceProductMonitorOptions.map(
        (monitorOption) => `reserved-desk/monitor:${monitorOption}`
      ),
      "reservation:meeting-room",
      "reservation:office",
    ].toSorted((left, right) => left.localeCompare(right))
  );
  expect(report.meetsRequiredCapacity).toBe(true);
  expect(report.supportedConcurrentRuns).toBe(3);
  expect(report.provisionedRunCapacity).toBe(4);
  expect(report.groups.find(({ id }) => id === "open-space")).toEqual({
    activeReservationCount: 1,
    activeReservationSeatCount: 2,
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    availableSeatCount: openSpaceMaximum * 8 - 2,
    availableTableCount: 0,
    id: "open-space",
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 2,
    peakActiveReservationTableCount: 1,
    requiredAvailableSeatCount: openSpaceMaximum * 2,
    requiredSeatCount: openSpaceMaximum * 4,
    requiredTags: ["cowork:open-space"],
    seatCounts: [openSpaceMaximum * 8],
    totalSeatCount: openSpaceMaximum * 8,
  });
  expect(report.groups.find(({ id }) => id === "reserved-desk")).toMatchObject({
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    meetsRequiredCapacity: true,
    requiredAvailableSeatCount: reservedDeskMaximum * 2,
    requiredSeatCount: reservedDeskMaximum * 4,
    requiredTags: ["cowork:reserved-desk"],
    totalSeatCount: 4,
  });
  for (const monitorOption of workspaceProductMonitorOptions) {
    expect(
      report.groups.find(
        ({ id }) => id === `reserved-desk/monitor:${monitorOption}`
      )
    ).toMatchObject({
      assignableTableCount: 1,
      meetsRequiredCapacity: true,
      requiredAvailableSeatCount: reservedDeskMaximum * 2,
      requiredTags: [
        "cowork:reserved-desk",
        ...workspaceProductMonitorOptionTableTags[monitorOption],
      ],
    });
  }
  expect(
    report.groups.find(({ id }) => id === "reservation:office")
  ).toMatchObject({
    assignableTableCount: 1,
    meetsRequiredCapacity: true,
    requiredSeatCount: 2,
    requiredTableCount: 1,
    seatCounts: [8],
  });
  const serialized = JSON.stringify(report);
  expect(serialized).not.toContain("open-space-table");
  expect(serialized).not.toContain("reserved-desk-table");
  expect(serialized).not.toContain("provider-room-id");
  expect(serialized).not.toContain("provider-room-2");
  expect(serialized).not.toContain("provider-room-3");
  expect(serialized).not.toContain("provider-room-headroom");
  expect(serialized).not.toContain("provider-office");
});

test("fails closed when tables carry only legacy tier tags", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("legacy-basic", ["tier:basic"], 100),
      makeTable("legacy-profi", ["tier:profi"], 100),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(false);
  for (const groupId of ["open-space", "reserved-desk"]) {
    expect(report.groups.find(({ id }) => id === groupId)).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("excludes open-space tables carrying stray monitor tags", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("open-space-monitor", [
        "cowork:open-space",
        ...workspaceProductMonitorOptionTableTags["2x27-qhd"],
      ]),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(false);
  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    assignableTableCount: 0,
    meetsRequiredCapacity: false,
  });
});

test("reserved-desk without addon rejects any monitor tag", () => {
  const partialConfig = workspaceProductMonitorOptionTableTags[
    "2x27-qhd"
  ].slice(0, 1);
  for (const tags of [
    [...partialConfig],
    [...workspaceProductMonitorOptionTableTags["2x27-qhd"]],
    ["monitor:unknown"],
  ]) {
    const report = makeWorkspaceE2ECapacityReport({
      from: new Date("2099-08-01T00:00:00.000Z"),
      reservations: [],
      tables: [
        makeTable("reserved-desk-tagged", ["cowork:reserved-desk", ...tags], 8),
      ],
      to: new Date("2099-09-01T00:00:00.000Z"),
    });

    expect(
      report.groups.find(({ id }) => id === "reserved-desk")
    ).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("configured monitor queries reject partial, unknown, and wrong-size configs", () => {
  const configured = workspaceProductMonitorOptionTableTags["2x27-qhd"];
  const otherConfig = workspaceProductMonitorOptions
    .filter((option) => option !== "2x27-qhd")
    .flatMap((option) => workspaceProductMonitorOptionTableTags[option]);
  for (const tags of [
    [...configured.slice(0, configured.length - 1)],
    [...configured, "monitor:unknown"],
    [...otherConfig],
  ]) {
    const report = makeWorkspaceE2ECapacityReport({
      from: new Date("2099-08-01T00:00:00.000Z"),
      reservations: [],
      tables: [
        makeTable("configured-desk", ["cowork:reserved-desk", ...tags], 8),
      ],
      to: new Date("2099-09-01T00:00:00.000Z"),
    });

    expect(
      report.groups.find(({ id }) => id === "reserved-desk/monitor:2x27-qhd")
    ).toMatchObject({
      assignableTableCount: 0,
      meetsRequiredCapacity: false,
    });
  }
});

test("fails when peak active reservations consume run and cleanup headroom", () => {
  const requiredAvailableSeatCount =
    (1 + 1) * workspaceE2EMaximumSameDateCoworkReservations["open-space"];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [makeReservation("open-space-table", 10)],
    tables: [
      makeTable(
        "open-space-table",
        ["cowork:open-space"],
        requiredAvailableSeatCount + 9
      ),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    availableSeatCount: 7,
    meetsRequiredCapacity: false,
    peakActiveReservationSeatCount: 10,
    requiredAvailableSeatCount,
  });
});

test("does not add reservation usage from non-overlapping dates", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 5),
      makeReservation("open-space-table", 5, {
        endDate: "2099-08-05T18:00:00+00:00",
        startDate: "2099-08-05T08:00:00+00:00",
      }),
    ],
    tables: [makeTable("open-space-table", ["cowork:open-space"], 32)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationSeatCount: 10,
    availableSeatCount: 27,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 5,
  });
});

test("ignores cancelled reservations in capacity accounting", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("open-space-table", 32, { status: "CANCELLED" }),
    ],
    tables: [makeTable("open-space-table", ["cowork:open-space"], 32)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "open-space")).toMatchObject({
    activeReservationCount: 0,
    availableSeatCount: 32,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 0,
  });
});

test("legacy tier pools stay visible without required counts", () => {
  const report = makeWorkspaceE2ELegacyTierCleanupCapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("legacy-basic", ["tier:basic"], 16),
      makeTable("legacy-profi", ["tier:profi"], 100),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(
    workspaceE2ELegacyTierCleanupCapacityGroups.every(
      (group) =>
        group.requiredSeatCount === undefined &&
        group.requiredTableCount === undefined &&
        group.requiredAvailableSeatCount === undefined &&
        group.requiredAvailableTableCount === undefined
    )
  ).toBe(true);
  expect(report.groups.find(({ id }) => id === "tier:basic")).toMatchObject({
    assignableTableCount: 1,
    requiredTags: ["tier:basic"],
    totalSeatCount: 16,
  });
  expect(
    report.groups.find(({ id }) => id === "tier:basic")?.requiredSeatCount
  ).toBeUndefined();
  expect(report.meetsRequiredCapacity).toBe(true);
  expect(getWorkspaceE2ECapacityFailures(report)).toEqual([]);
});

const makeTable = (
  id: string,
  tags: readonly string[],
  seats: number,
  overrides: Partial<Table> = {}
): Table => ({
  _cloudId: "testing-cloud",
  display: true,
  enabled: true,
  id,
  name: "Aggregate-only test table",
  seats: String(seats),
  tags,
  ...overrides,
});

const makeReservation = (
  tableId: string,
  seats: number,
  overrides: Partial<Reservation> = {}
): Reservation => ({
  _branchId: "testing-branch",
  _cloudId: "testing-cloud",
  _tableId: tableId,
  endDate: "2099-08-03T18:00:00+00:00",
  seats: String(seats),
  startDate: "2099-08-03T08:00:00+00:00",
  status: "CONFIRMED",
  ...overrides,
});
