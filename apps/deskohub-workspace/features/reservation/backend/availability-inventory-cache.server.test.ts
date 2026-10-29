import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposReadFailure,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import type {
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import type { GoogleCalendarEventQuery } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { availabilityTags } from "@/shared/utils/cache-tags";
import * as limitationsModule from "./google-calendar-workspace-limitations.service";

const {
  GoogleCalendarWorkspaceLimitationsService,
  WorkspaceCalendarLimitation,
} = limitationsModule;

let providerFailure: DotyposReadFailure | undefined;

const table: DotyposTable = {
  _cloudId: "synthetic-cloud",
  id: "synthetic-table",
  name: "Synthetic table",
  seats: "2",
  tags: ["cowork:basic"],
};
const reservation: DotyposReservation = {
  _branchId: "synthetic-branch",
  _cloudId: "synthetic-cloud",
  _customerId: "synthetic-customer",
  _tableId: "synthetic-table",
  endDate: "2099-06-10T15:00:00Z",
  id: "synthetic-reservation",
  note: "Synthetic customer note",
  seats: "1",
  startDate: "2099-06-10T07:00:00Z",
  status: "CONFIRMED",
};
const limitation = WorkspaceCalendarLimitation.FullyOccupied({
  date: "2099-06-10",
});

const getTables = mock(() =>
  providerFailure ? Effect.fail(providerFailure) : Effect.succeed([table])
);
const listActiveReservationsOverlapping = mock(
  (_interval: { readonly startDate: Date; readonly endDate: Date }) =>
    Effect.succeed([reservation])
);
const listLimitations = mock((_query: GoogleCalendarEventQuery) =>
  Effect.succeed([limitation])
);
const nextCache = recordNextCache();

mock.module("next/cache", () => nextCache.module);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getTables,
    listActiveReservationsOverlapping,
  } as never),
}));
mock.module("./google-calendar-workspace-limitations.service", () => ({
  ...limitationsModule,
  GoogleCalendarWorkspaceLimitationsService: class extends GoogleCalendarWorkspaceLimitationsService {
    static override Live = Layer.succeed(
      GoogleCalendarWorkspaceLimitationsService,
      { listLimitations }
    );
  },
}));

const {
  loadSharedActiveReservations,
  loadSharedLimitations,
  loadSharedTables,
} = await import("./availability-inventory-cache.server");

beforeEach(() => {
  providerFailure = undefined;
  for (const fn of [
    getTables,
    listActiveReservationsOverlapping,
    listLimitations,
  ]) {
    fn.mockClear();
  }
  nextCache.clear();
});

describe("shared availability inventory", () => {
  test("shares only the reservation fields occupancy reads", async () => {
    const reservations = await loadSharedActiveReservations({
      startsAt: "2099-06-09T22:00:00.000Z",
      endsAt: "2099-06-10T22:00:00.000Z",
    });

    expect(reservations).toEqual([
      {
        id: "synthetic-reservation",
        status: "CONFIRMED",
        _tableId: "synthetic-table",
        startDate: "2099-06-10T07:00:00Z",
        endDate: "2099-06-10T15:00:00Z",
        seats: "1",
      },
    ]);
    expect(listActiveReservationsOverlapping).toHaveBeenCalledWith({
      startDate: new Date("2099-06-09T22:00:00.000Z"),
      endDate: new Date("2099-06-10T22:00:00.000Z"),
    });
    expect(nextCache.calls).toEqual([
      { cacheLife: "availabilityReservations" },
      { cacheTag: [availabilityTags.reservations] },
    ]);
  });

  test("tags tables and calendar limitations with their own lifetimes", async () => {
    expect(await loadSharedTables()).toEqual([table]);
    expect(
      await loadSharedLimitations({ from: "2099-06-10", to: "2099-06-10" })
    ).toEqual([limitation]);

    expect(nextCache.calls).toEqual([
      { cacheLife: "availabilityTables" },
      { cacheTag: [availabilityTags.tables] },
      { cacheLife: "availabilityCalendar" },
      { cacheTag: [availabilityTags.calendar] },
    ]);
  });

  test("keeps a failed load out of the shared cache", async () => {
    providerFailure = new DotyposUnavailable({
      operation: "getTables",
      reason: "server",
      message: "Synthetic outage",
    });

    await expect(loadSharedTables()).rejects.toBeDefined();

    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });
});
