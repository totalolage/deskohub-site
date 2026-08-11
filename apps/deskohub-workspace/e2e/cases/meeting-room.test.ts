import "../../shared/polyfills/temporal";

import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertHeldMeetingRoomReservation,
  assertMeetingRoomSlotAvailability,
  isMeetingRoomUnavailableFromInventory,
} from "./meeting-room";

test("keeps the deployed E2E runner independent of generated translations", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./meeting-room.ts", import.meta.url))
  ).text();

  expect(source).not.toContain("product-catalog.i18n");
  expect(source).not.toContain("@/features/i18n");
});

test("keeps a held interval available while another meeting-room table is empty", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };
  const tables = [
    makeMeetingRoomTable("room-a"),
    makeMeetingRoomTable("room-b"),
  ];
  const reservations = [makeMeetingRoomReservation("room-a")];

  expect(
    Effect.runSync(
      isMeetingRoomUnavailableFromInventory({ reservations, slot, tables })
    )
  ).toBe(false);
});

test("validates an unpaid meeting-room hold without waiting for confirmation", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };

  expect(() =>
    assertHeldMeetingRoomReservation({
      expected: {
        customerId: DotyposCustomerIdSchema.make("customer-a"),
        reservationId: DotyposReservationIdSchema.make("reservation-a"),
        workspaceReservationId: workspaceReservationIdSchema.make(
          "workspace-reservation-a"
        ),
      },
      reservations: [makeMeetingRoomReservation("room-a")],
      slot,
      tables: [makeMeetingRoomTable("room-a")],
    })
  ).not.toThrow();
});

test("treats a held interval as unavailable when every meeting room is occupied", () => {
  const slot = {
    date: "2099-09-01",
    duration: { unit: "hour", amount: 1 } as const,
    endsAt: "2099-09-01T09:00:00Z",
    startDateTime: "2099-09-01T10:00",
    startsAt: "2099-09-01T08:00:00Z",
  };

  expect(
    Effect.runSync(
      isMeetingRoomUnavailableFromInventory({
        reservations: [makeMeetingRoomReservation("room-a")],
        slot,
        tables: [makeMeetingRoomTable("room-a")],
      })
    )
  ).toBe(true);
});

test("asserts the public interval availability expected from aggregate capacity", async () => {
  const interval = getMeetingRoomReservationInterval("2099-09-01T10:00", {
    unit: "hour",
    amount: 1,
  });
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    {
      date: "2099-09-01",
      duration: { unit: "hour", amount: 1 },
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    }
  );
  const config: WorkspaceE2EConfig = {
    baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    timeouts: { ...workspaceE2ETimeouts, datasource: 1 },
  };
  const fetchMock = mock(() =>
    Promise.resolve(
      Response.json({
        meetingRoomUnavailable: false,
        unavailableDates: [],
      })
    )
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  await expect(
    Effect.runPromise(
      assertMeetingRoomSlotAvailability(config, data, false).pipe(
        Effect.provide(httpClientLayer)
      )
    )
  ).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

const makeMeetingRoomTable = (id: string): Table => ({
  display: true,
  enabled: true,
  id,
  name: id,
  seats: "1",
  tags: ["reservation:meeting-room"],
});

const makeMeetingRoomReservation = (tableId: string): Reservation => ({
  _customerId: "customer-a",
  _tableId: tableId,
  endDate: "2099-09-01T09:00:00Z",
  id: "reservation-a",
  note: "Workspace reservation workspace-reservation-a",
  seats: "1",
  startDate: "2099-09-01T08:00:00Z",
  status: "NEW",
});
