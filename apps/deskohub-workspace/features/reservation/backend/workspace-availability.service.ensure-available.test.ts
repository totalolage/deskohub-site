import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { GoogleCalendarWorkspaceLimitationsService } from "@/features/reservation/backend/google-calendar-workspace-limitations.service";
import {
  type AvailabilityReservation,
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";

const meetingRoomTable: Table = {
  _cloudId: "cloud",
  id: "room-1",
  display: true,
  enabled: true,
  name: "Meeting room",
  seats: "1",
  tags: ["reservation:meeting-room"],
};

const officeTable: Table = {
  _cloudId: "cloud",
  id: "office-1",
  display: true,
  enabled: true,
  name: "Office",
  seats: "6",
  tags: ["reservation:office"],
};

const makeDotyposReservation = (
  startDate: string,
  endDate: string,
  tableId = "room-1"
): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  id: "preceding-reservation",
  _tableId: tableId,
  startDate,
  endDate,
  seats: "1",
  status: "CONFIRMED",
});

const checkAvailability = async (
  reservation: AvailabilityReservation,
  reservations: readonly Reservation[]
) => {
  const dotyposService = {
    getTables: mock(() => Effect.succeed([meetingRoomTable, officeTable])),
    listActiveReservationsOverlapping: mock((interval) => {
      const intervalStart = interval.startDate.getTime();
      const intervalEnd = interval.endDate.getTime();
      return Effect.succeed(
        reservations.filter((dotyposReservation) => {
          const startDate = new Date(dotyposReservation.startDate).getTime();
          const endDate = new Date(dotyposReservation.endDate).getTime();
          return startDate < intervalEnd && endDate > intervalStart;
        })
      );
    }),
  };
  const availabilityLayer = WorkspaceAvailabilityService.Default.pipe(
    Layer.provide(AdvisoryAvailabilityInventory.Provider),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DotyposService, dotyposService as never),
        Layer.succeed(GoogleCalendarWorkspaceLimitationsService, {
          listLimitations: mock(() => Effect.succeed([])),
        } as never),
        Layer.succeed(WorkspaceReservationRepository, {
          selectExpiredHoldDotyposReservationIds: mock(() =>
            Effect.succeed([])
          ),
        } as never)
      )
    )
  );

  return Effect.gen(function* () {
    const availability = yield* WorkspaceAvailabilityService;
    return yield* availability.ensureAvailable(reservation);
  }).pipe(Effect.provide(availabilityLayer), Effect.runPromise);
};

describe("ensureAvailable for a meeting room with early setup", () => {
  const morningBooking = {
    kind: "meeting-room" as const,
    startsAt: "2099-06-10T10:00:00+02:00",
    endsAt: "2099-06-10T11:00:00+02:00",
  };

  test("rejects an early setup overlap while allowing the back-to-back booking without setup", async () => {
    const precedingReservation = makeDotyposReservation(
      "2099-06-10T09:00:00+02:00",
      "2099-06-10T10:00:00+02:00"
    );

    await expect(
      checkAvailability({ ...morningBooking, earlySetup: true }, [
        precedingReservation,
      ])
    ).rejects.toBeInstanceOf(WorkspaceTableUnavailableError);
    await expect(
      checkAvailability(morningBooking, [precedingReservation])
    ).resolves.toBeUndefined();
  });

  test("checks early setup across midnight with a half-open boundary", async () => {
    const midnightBooking = {
      kind: "meeting-room" as const,
      startsAt: "2099-06-10T00:00:00+02:00",
      endsAt: "2099-06-10T01:00:00+02:00",
      earlySetup: true,
    };
    const precedingReservation = makeDotyposReservation(
      "2099-06-09T22:00:00+02:00",
      "2099-06-09T23:50:00+02:00"
    );

    await expect(
      checkAvailability(midnightBooking, [precedingReservation])
    ).rejects.toBeInstanceOf(WorkspaceTableUnavailableError);
    await expect(
      checkAvailability(midnightBooking, [
        {
          ...precedingReservation,
          endDate: "2099-06-09T23:45:00+02:00",
        },
      ])
    ).resolves.toBeUndefined();
  });
});

describe("ensureAvailable for an office", () => {
  // Prague is UTC+2 in June: the office holds 2099-06-20 00:00 to
  // 2099-06-22 00:00 local time.
  const office = {
    kind: "office" as const,
    startsOn: "2099-06-20",
    endsOn: "2099-06-21",
    seats: 3,
  };

  test("holds every Prague day through the end date's midnight", async () => {
    await expect(
      checkAvailability(office, [
        makeDotyposReservation(
          "2099-06-21T21:00:00Z",
          "2099-06-21T21:30:00Z",
          "office-1"
        ),
      ])
    ).rejects.toBeInstanceOf(WorkspaceTableUnavailableError);
    await expect(
      checkAvailability(office, [
        makeDotyposReservation(
          "2099-06-21T22:00:00Z",
          "2099-06-21T23:00:00Z",
          "office-1"
        ),
      ])
    ).resolves.toBeUndefined();
  });
});
