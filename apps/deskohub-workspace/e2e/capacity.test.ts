import { expect, test } from "bun:test";
import type { Reservation } from "@deskohub/dotypos";
import type { Table } from "@deskohub/dotypos/generated";
import { workspaceProductMonitorOptionTableTags } from "@/features/checkout/product-catalog";
import {
  getWorkspaceE2ECapacityFailures,
  getWorkspaceE2ECapacityInterval,
  getWorkspaceE2EDateInterval,
  makeWorkspaceE2ECapacityReport,
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

test("reports only aggregate capacity for every workspace table pool", () => {
  const tables: Table[] = [
    makeTable("basic-table", ["tier:basic"], 16),
    makeTable("plus-table", ["tier:plus"], 4),
    ...Object.entries(workspaceProductMonitorOptionTableTags).map(
      ([monitorOption, tags], index) =>
        makeTable(`profi-${monitorOption}`, ["tier:profi", ...tags], 4 + index)
    ),
    makeTable("provider-room-id", ["reservation:meeting-room"], 1),
    makeTable("provider-room-2", ["reservation:meeting-room"], 1),
    makeTable("provider-room-3", ["reservation:meeting-room"], 1),
    makeTable("provider-room-headroom", ["reservation:meeting-room"], 1),
    makeTable("provider-office", ["reservation:office"], 8),
    makeTable("hidden-basic", ["tier:basic"], 100, { display: false }),
  ];
  const reservations: Reservation[] = [
    makeReservation("basic-table", 2),
    makeReservation("provider-room-id", 1),
    makeReservation("plus-table", 1, { status: "CANCELLED" }),
  ];
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations,
    tables,
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(true);
  expect(report.supportedConcurrentRuns).toBe(3);
  expect(report.provisionedRunCapacity).toBe(4);
  expect(report.groups.find(({ id }) => id === "tier:basic")).toEqual({
    activeReservationCount: 1,
    activeReservationSeatCount: 2,
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    availableSeatCount: 14,
    availableTableCount: 0,
    id: "tier:basic",
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 2,
    peakActiveReservationTableCount: 1,
    requiredAvailableSeatCount: 8,
    requiredSeatCount: 16,
    requiredTags: ["tier:basic"],
    seatCounts: [16],
    totalSeatCount: 16,
  });
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
  expect(serialized).not.toContain("basic-table");
  expect(serialized).not.toContain("provider-room-id");
  expect(serialized).not.toContain("provider-room-2");
  expect(serialized).not.toContain("provider-room-3");
  expect(serialized).not.toContain("provider-room-headroom");
  expect(serialized).not.toContain("provider-office");
});

test("fails the aggregate contract when a monitor-specific pool is short", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [],
    tables: [
      makeTable("generic-profi", ["tier:profi"], 100),
      makeTable(
        "specific-profi",
        ["tier:profi", ...workspaceProductMonitorOptionTableTags["2x27-qhd"]],
        3
      ),
    ],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.meetsRequiredCapacity).toBe(false);
  expect(
    report.groups.find(({ id }) => id === "tier:profi/monitor:2x27-qhd")
  ).toMatchObject({
    meetsRequiredCapacity: false,
    requiredSeatCount: 4,
    totalSeatCount: 3,
  });
  expect(getWorkspaceE2ECapacityFailures(report)).toContainEqual({
    activeReservationCount: 0,
    activeVisibleTableCount: 1,
    assignableTableCount: 1,
    availableSeatCount: 3,
    availableTableCount: 1,
    id: "tier:profi/monitor:2x27-qhd",
    peakActiveReservationSeatCount: 0,
    peakActiveReservationTableCount: 0,
    requiredAvailableSeatCount: 2,
    requiredAvailableTableCount: undefined,
    requiredSeatCount: 4,
    requiredTableCount: undefined,
    totalSeatCount: 3,
  });
});

test("fails when peak active reservations consume run and cleanup headroom", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [makeReservation("basic-table", 9)],
    tables: [makeTable("basic-table", ["tier:basic"], 16)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "tier:basic")).toMatchObject({
    availableSeatCount: 7,
    meetsRequiredCapacity: false,
    peakActiveReservationSeatCount: 9,
    requiredAvailableSeatCount: 8,
  });
});

test("does not add reservation usage from non-overlapping dates", () => {
  const report = makeWorkspaceE2ECapacityReport({
    from: new Date("2099-08-01T00:00:00.000Z"),
    reservations: [
      makeReservation("basic-table", 5),
      makeReservation("basic-table", 5, {
        endDate: "2099-08-05T18:00:00+00:00",
        startDate: "2099-08-05T08:00:00+00:00",
      }),
    ],
    tables: [makeTable("basic-table", ["tier:basic"], 16)],
    to: new Date("2099-09-01T00:00:00.000Z"),
  });

  expect(report.groups.find(({ id }) => id === "tier:basic")).toMatchObject({
    activeReservationSeatCount: 10,
    availableSeatCount: 11,
    meetsRequiredCapacity: true,
    peakActiveReservationSeatCount: 5,
  });
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
