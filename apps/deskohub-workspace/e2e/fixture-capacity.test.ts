import { afterEach, expect, setSystemTime, test } from "bun:test";
import { DotyposReservationSchema } from "@deskohub/dotypos";
import { getDatasourceConfig } from "./config";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import {
  fixtureCapacityLifetime,
  fixtureCapacityReport,
  fixtureCapacityWindows,
  makeFixtureCapacityObservation,
  selectSyntheticReservationTable,
} from "./fixture-capacity";
import { fixtureCapacityTestTable } from "./fixture-capacity.test-fixture";

afterEach(() => setSystemTime());
const now = Date.parse("2026-11-08T12:00:00Z");
const config = getDatasourceConfig(
  makeTestE2EEnvironment({ TARGET_SHA: "a".repeat(40) })
);
const windows = fixtureCapacityWindows(now, now + fixtureCapacityLifetime);
const reservation = (
  start: number,
  end: number,
  seats: number,
  customer = "another-owner"
) =>
  DotyposReservationSchema.make({
    id: `${start}-${seats}-${customer}`,
    _cloudId: "cloud",
    _branchId: "branch",
    _tableId: fixtureCapacityTestTable.id,
    _customerId: customer,
    status: "CONFIRMED",
    startDate: new Date(start).toISOString(),
    endDate: new Date(end).toISOString(),
    seats: String(seats),
  });
const observe = (
  past: ReturnType<typeof reservation>[] = [],
  future: ReturnType<typeof reservation>[] = [],
  seats = "24"
) =>
  makeFixtureCapacityObservation({
    config,
    startMillis: now,
    endMillis: now + fixtureCapacityLifetime,
    observedMillis: now,
    tables: [{ ...fixtureCapacityTestTable, seats }],
    past,
    future,
  });

test("uses both fixed-day envelopes and counts crossing-start overlap from every owner, including expired owners", () => {
  setSystemTime(now);
  expect(windows.past.startDate.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  expect(windows.past.endDate.toISOString()).toBe("2026-11-06T12:50:00.000Z");
  expect(windows.future.startDate.getTime()).toBe(now + 120 * 86400000);
  expect(windows.future.endDate.getTime()).toBe(
    now + 120 * 86400000 + fixtureCapacityLifetime + 7200000
  );
  const start = windows.past.startDate.getTime();
  const observation = observe([
    reservation(start - 1000, start + 1000, 3, "expired-owner"),
    { ...reservation(start, start + 1000, 4), status: "NEW" },
    { ...reservation(start, start + 1000, 90), status: "CANCELLED" },
    reservation(start - 2000, start, 80),
    reservation(
      windows.past.endDate.getTime(),
      windows.past.endDate.getTime() + 1000,
      80
    ),
  ]);
  expect(observation.pastPeak).toBe(7);
  expect(observation.futurePeak).toBe(0);
  const report = fixtureCapacityReport(observation);
  expect(report.past.plannedFixtureSeats).toBe(12);
  expect(report.future.plannedFixtureSeats).toBe(6);
  expect(JSON.stringify(report)).not.toContain("owner");
  expect(JSON.stringify(report)).not.toContain("fingerprint");
  expect(JSON.stringify(report)).not.toContain("Digest");
});

test("peak uses end-before-start at touching endpoints, not the sum, with separate window results", () => {
  const start = windows.past.startDate.getTime();
  const observation = observe(
    [
      reservation(start, start + 1000, 6),
      reservation(start + 1000, start + 2000, 6),
    ],
    [],
    "18"
  );
  expect(observation.pastPeak).toBe(6);
  expect(observation.futurePeak).toBe(0);
  const pastInsufficient = fixtureCapacityReport(
    observe([reservation(start, start + 2000, 7)], [], "18")
  );
  expect(pastInsufficient.past.meetsRequiredCapacity).toBe(false);
  expect(pastInsufficient.future.meetsRequiredCapacity).toBe(true);
  const futureStart = windows.future.startDate.getTime();
  const futureInsufficient = fixtureCapacityReport(
    observe([], [reservation(futureStart, futureStart + 1000, 13)], "18")
  );
  expect(futureInsufficient.future.meetsRequiredCapacity).toBe(false);
  expect(futureInsufficient.past.meetsRequiredCapacity).toBe(true);
});

test("selector preserves the first eligible provider table and never skips an invalid seat capacity", () => {
  const first = {
    ...fixtureCapacityTestTable,
    id: "first",
    name: "Z table",
    seats: "invalid",
  };
  const second = { ...fixtureCapacityTestTable, id: "second", name: "A table" };
  expect(
    selectSyntheticReservationTable([
      { ...fixtureCapacityTestTable, enabled: false },
      { ...fixtureCapacityTestTable, display: false },
      { ...fixtureCapacityTestTable, tags: ["reservation:office"] },
      { ...fixtureCapacityTestTable, tags: ["reservation:meeting-room"] },
      first,
      second,
    ])
  ).toBe(first);
  expect(() =>
    makeFixtureCapacityObservation({
      config,
      startMillis: now,
      endMillis: now + fixtureCapacityLifetime,
      observedMillis: now,
      tables: [{ ...fixtureCapacityTestTable, seats: undefined }],
      past: [],
      future: [],
    })
  ).toThrow();
  for (const seats of ["0", "-1", "1.5", "bad", "9007199254740992"]) {
    expect(() => observe([], [], seats)).toThrow();
  }
  const start = windows.past.startDate.getTime();
  for (const seats of ["bad", "0", "-1", "1.5"]) {
    expect(() =>
      observe([{ ...reservation(start, start + 1000, 1), seats }])
    ).toThrow("Unknown");
  }
});
