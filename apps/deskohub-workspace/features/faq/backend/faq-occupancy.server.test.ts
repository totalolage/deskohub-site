import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { DotyposRejected, DotyposService } from "@deskohub/dotypos";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

let tables: readonly DotyposTable[] = [];
let reservations: readonly DotyposReservation[] = [];
let providerFailure: DotyposRejected | undefined;
let requestedBounds:
  | {
      readonly startsAtOrAfter?: string;
      readonly startsBefore?: string;
    }
  | undefined;

const getTables = mock(() =>
  providerFailure ? Effect.fail(providerFailure) : Effect.succeed([...tables])
);
const listReservations = mock(
  (
    bounds: {
      readonly startsAtOrAfter?: string;
      readonly startsBefore?: string;
    } = {}
  ) => {
    requestedBounds = bounds;
    return providerFailure
      ? Effect.fail(providerFailure)
      : Effect.succeed([...reservations]);
  }
);
const nextCache = recordNextCache();

mock.module("next/cache", () => nextCache.module);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getTables,
    listReservations,
  }),
}));
const { loadFaqOccupancyStats } = await import("./faq-occupancy.server");

const coworkTableId = "synthetic-cowork-table";

const makeTable = (input: Partial<DotyposTable> = {}): DotyposTable => ({
  _cloudId: "synthetic-cloud",
  id: coworkTableId,
  name: "Synthetic cowork table",
  seats: "4",
  tags: ["cowork:basic"],
  ...input,
});

const makeReservation = (id: string): DotyposReservation => ({
  _branchId: "synthetic-branch",
  _cloudId: "synthetic-cloud",
  _tableId: coworkTableId,
  endDate: "2026-04-01T09:00:00Z",
  id,
  seats: "1",
  startDate: "2026-04-01T08:00:00Z",
  status: "CONFIRMED",
});

const makeReservationAt = (
  id: string,
  startDate: string
): DotyposReservation => ({
  ...makeReservation(id),
  endDate: Temporal.Instant.from(startDate).add({ hours: 1 }).toString(),
  startDate,
});

beforeEach(() => {
  setSystemTime(new Date("2026-05-15T12:00:00Z"));
  tables = [];
  reservations = [];
  providerFailure = undefined;
  requestedBounds = undefined;
  getTables.mockClear();
  listReservations.mockClear();
  nextCache.clear();
});

afterEach(() => setSystemTime());

describe("loadFaqOccupancyStats", () => {
  test("recomputes the previous complete month from Prague time on each execution", async () => {
    tables = [makeTable()];

    setSystemTime(new Date("2026-04-30T21:59:59Z"));
    reservations = Array.from({ length: 17 }, (_, index) =>
      makeReservationAt(`synthetic-march-${index}`, "2026-03-15T08:00:00Z")
    );

    const marchStats = await loadFaqOccupancyStats();

    expect(marchStats?.averageReservationsPerDay).toBe(0.5);
    expect(requestedBounds).toEqual({
      startsAtOrAfter: "2026-02-28T23:00:00Z",
      startsBefore: "2026-03-31T22:00:00Z",
    });

    setSystemTime(new Date("2026-04-30T22:00:00Z"));
    reservations = Array.from({ length: 17 }, (_, index) =>
      makeReservationAt(`synthetic-april-${index}`, "2026-04-15T08:00:00Z")
    );

    const aprilStats = await loadFaqOccupancyStats();

    expect(aprilStats?.averageReservationsPerDay).toBe(0.6);
    expect(requestedBounds).toEqual({
      startsAtOrAfter: "2026-03-31T22:00:00Z",
      startsBefore: "2026-04-30T22:00:00Z",
    });
  });

  test("shares the stats for their full lifetime", async () => {
    tables = [makeTable()];

    await loadFaqOccupancyStats();

    expect(nextCache.calls).toEqual([
      { cacheLife: { stale: 30, revalidate: 300, expire: 600 } },
    ]);
  });

  test("reports unknown stats on a Dotypos failure instead of zero aggregates, shared briefly", async () => {
    providerFailure = new DotyposRejected({
      operation: "listReservations",
      reason: "invalid-response",
      message: "Synthetic Dotypos provider failure",
    });

    await expect(loadFaqOccupancyStats()).resolves.toBeUndefined();
    expect(nextCache.calls).toEqual([
      { cacheLife: { stale: 30, revalidate: 60, expire: 300 } },
    ]);
  });
});
