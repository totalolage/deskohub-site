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
import { DotyposService, ExternalAPIError } from "@deskohub/dotypos";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";

let tables: readonly DotyposTable[] = [];
let reservations: readonly DotyposReservation[] = [];
let providerFailure: ExternalAPIError | undefined;
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
const cacheLife = mock(() => undefined);

mock.module("next/cache", () => ({ cacheLife }));
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getTables,
    listReservations,
  }),
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    (_operation: string, _options?: { readonly boundary?: string }) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
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
  cacheLife.mockClear();
});

afterEach(() => setSystemTime());

describe("loadFaqOccupancyStats", () => {
  test("loads bounded synthetic provider data and returns only the aggregates", async () => {
    tables = [makeTable()];
    reservations = Array.from({ length: 6 }, (_, index) =>
      makeReservation(`synthetic-reservation-${index}`)
    );

    const stats = await loadFaqOccupancyStats();

    expect(stats).toEqual({
      averageReservationsPerDay: 0.2,
      coworkSeatCapacity: 4,
    });
    expect(Object.keys(stats).sort()).toEqual([
      "averageReservationsPerDay",
      "coworkSeatCapacity",
    ]);
    expect(getTables).toHaveBeenCalledTimes(1);
    expect(listReservations).toHaveBeenCalledTimes(1);
    expect(requestedBounds).toEqual({
      startsAtOrAfter: "2026-03-31T22:00:00Z",
      startsBefore: "2026-04-30T22:00:00Z",
    });
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 30,
      revalidate: 300,
      expire: 600,
    });
  });

  test("recomputes the previous complete month from Prague time on each execution", async () => {
    tables = [makeTable()];

    setSystemTime(new Date("2026-04-30T21:59:59Z"));
    reservations = Array.from({ length: 17 }, (_, index) =>
      makeReservationAt(`synthetic-march-${index}`, "2026-03-15T08:00:00Z")
    );

    const marchStats = await loadFaqOccupancyStats();

    expect(marchStats.averageReservationsPerDay).toBe(0.5);
    expect(requestedBounds).toEqual({
      startsAtOrAfter: "2026-02-28T23:00:00Z",
      startsBefore: "2026-03-31T22:00:00Z",
    });

    setSystemTime(new Date("2026-04-30T22:00:00Z"));
    reservations = Array.from({ length: 17 }, (_, index) =>
      makeReservationAt(`synthetic-april-${index}`, "2026-04-15T08:00:00Z")
    );

    const aprilStats = await loadFaqOccupancyStats();

    expect(aprilStats.averageReservationsPerDay).toBe(0.6);
    expect(requestedBounds).toEqual({
      startsAtOrAfter: "2026-03-31T22:00:00Z",
      startsBefore: "2026-04-30T22:00:00Z",
    });
    expect(cacheLife).toHaveBeenNthCalledWith(1, {
      stale: 30,
      revalidate: 300,
      expire: 600,
    });
    expect(cacheLife).toHaveBeenNthCalledWith(2, {
      stale: 30,
      revalidate: 300,
      expire: 600,
    });
  });

  test("returns a real zero aggregate when the provider returns no data", async () => {
    await expect(loadFaqOccupancyStats()).resolves.toEqual({
      averageReservationsPerDay: 0,
      coworkSeatCapacity: 0,
    });

    expect(listReservations).toHaveBeenCalledTimes(1);
    expect(cacheLife).toHaveBeenCalledWith({
      stale: 30,
      revalidate: 300,
      expire: 600,
    });
  });

  test("preserves a Dotypos failure instead of returning zero aggregates", async () => {
    providerFailure = new ExternalAPIError({
      service: "Dotypos",
      operation: "listReservations",
      message: "Synthetic Dotypos provider failure",
    });

    await expect(loadFaqOccupancyStats()).rejects.toBe(providerFailure);
  });
});
