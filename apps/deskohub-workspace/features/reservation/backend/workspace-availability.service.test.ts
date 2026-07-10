import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import {
  GoogleCalendarWorkspaceLimitationsService,
  WorkspaceCalendarLimitation,
  type WorkspaceCalendarLimitation as WorkspaceCalendarLimitationType,
} from "./google-calendar-workspace-limitations.service";
import type { WorkspaceAvailabilityService } from "./workspace-availability.service";
import { WorkspaceReservationRepository } from "./workspace-reservation.repository";

const testDate = "2099-06-10";
const nextTestDate = "2099-06-11";
const testStart = "2099-06-09T22:00:00Z";
const testEnd = "2099-06-10T22:00:00Z";

const makeTable = (input: {
  readonly id: string;
  readonly tags: readonly string[];
  readonly name?: string;
  readonly seats?: string;
  readonly display?: boolean;
  readonly enabled?: boolean;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  name: input.name ?? input.id,
  seats: "1",
  ...input,
  tags: [...input.tags],
});

const makeReservation = (input: {
  readonly id?: string;
  readonly tableId: string;
  readonly status: Reservation["status"];
  readonly seats?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  id: input.id,
  _tableId: input.tableId,
  startDate: input.startDate ?? testStart,
  endDate: input.endDate ?? testEnd,
  seats: input.seats ?? "1",
  status: input.status,
});

const defaultTables = [
  makeTable({ id: "basic-1", tags: ["tier:basic"] }),
  makeTable({ id: "basic-2", tags: ["tier:basic"] }),
  makeTable({ id: "plus-1", tags: ["tier:plus"] }),
  makeTable({
    id: "profi-27-qhd",
    tags: [
      "tier:profi",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:qhd",
    ],
  }),
  makeTable({
    id: "profi-32-qhd",
    tags: [
      "tier:profi",
      "monitor:count:2",
      "monitor:size:32",
      "monitor:resolution:qhd",
    ],
  }),
  makeTable({
    id: "profi-27-4k",
    tags: [
      "tier:profi",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:4k",
    ],
  }),
  makeTable({
    id: "profi-32-4k",
    tags: [
      "tier:profi",
      "monitor:count:2",
      "monitor:size:32",
      "monitor:resolution:4k",
    ],
  }),
] satisfies readonly Table[];

const runWithInventory = async <A>(
  effect: Effect.Effect<A, unknown, WorkspaceAvailabilityService>,
  input: {
    readonly tables?: readonly Table[];
    readonly reservations?: readonly Reservation[];
    readonly expiredHoldDotyposReservationIds?: readonly string[];
    readonly expiredHoldDotyposReservationIdsError?: boolean;
    readonly limitations?: readonly WorkspaceCalendarLimitationType[];
  } = {}
) => {
  const availability = await import("./workspace-availability.service");

  return effect.pipe(
    Effect.provide(availability.WorkspaceAvailabilityServiceLive),
    Effect.provide(
      Layer.succeed(DotyposService, {
        getTables: mock(() =>
          Effect.succeed([...(input.tables ?? defaultTables)])
        ),
        listReservations: mock(() =>
          Effect.succeed([...(input.reservations ?? [])])
        ),
      })
    ),
    Effect.provide(
      Layer.succeed(GoogleCalendarWorkspaceLimitationsService, {
        listLimitations: mock(() =>
          Effect.succeed([...(input.limitations ?? [])])
        ),
      })
    ),
    Effect.provide(
      Layer.succeed(WorkspaceReservationRepository, {
        selectExpiredHoldDotyposReservationIds: mock(() => {
          if (input.expiredHoldDotyposReservationIdsError) {
            return Effect.fail(new Error("expired hold filter failed"));
          }

          return Effect.succeed([
            ...(input.expiredHoldDotyposReservationIds ?? []),
          ]);
        }),
      } as never)
    ),
    Effect.runPromise
  );
};

const getAvailability = (input: {
  readonly date?: string;
  readonly from?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly to?: string;
  readonly _tag?: "cowork" | "meeting-room";
  readonly entryTier?: "basic" | "plus" | "profi";
  readonly monitorOption?: "2x27-qhd" | "2x32-qhd" | "2x27-4k" | "2x32-4k";
  readonly tables?: readonly Table[];
  readonly reservations?: readonly Reservation[];
  readonly expiredHoldDotyposReservationIds?: readonly string[];
  readonly expiredHoldDotyposReservationIdsError?: boolean;
  readonly limitations?: readonly WorkspaceCalendarLimitationType[];
}) =>
  runWithInventory(
    Effect.gen(function* () {
      const availability = yield* Effect.promise(
        () => import("./workspace-availability.service")
      );
      const service = yield* availability.WorkspaceAvailabilityService;
      const baseQuery = {
        date: input.date,
        from: input.from ?? testDate,
        to: input.to ?? testDate,
      };

      return yield* input._tag === "meeting-room"
        ? service.getAvailability({
            ...baseQuery,
            _tag: "meeting-room",
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          })
        : service.getAvailability({
            ...baseQuery,
            _tag: "cowork",
            entryTier: input.entryTier,
            monitorOption: input.monitorOption,
          });
    }),
    input
  );

describe("WorkspaceAvailabilityService", () => {
  test("counts NEW reservations as occupied for selected monitor setup dates", async () => {
    const availability = await getAvailability({
      entryTier: "profi",
      monitorOption: "2x27-qhd",
      reservations: [
        makeReservation({ tableId: "profi-27-qhd", status: "NEW" }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
  });

  test("counts CONFIRMED reservations as occupied for selected-date monitor options", async () => {
    const availability = await getAvailability({
      date: testDate,
      reservations: [
        makeReservation({ tableId: "profi-27-qhd", status: "CONFIRMED" }),
      ],
    });

    expect(availability.unavailableMonitorOptions).toContain("2x27-qhd");
    expect(availability.unavailableMonitorOptions).not.toContain("2x32-qhd");
  });

  test("ignores CANCELLED reservations", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "profi",
      monitorOption: "2x27-qhd",
      reservations: [
        makeReservation({ tableId: "profi-27-qhd", status: "CANCELLED" }),
      ],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.unavailableMonitorOptions).not.toContain("2x27-qhd");
  });

  test("ignores expired local holds that Dotypos still reports", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "profi",
      monitorOption: "2x27-qhd",
      reservations: [
        makeReservation({
          id: "expired-dotypos-reservation-id",
          tableId: "profi-27-qhd",
          status: "NEW",
        }),
      ],
      expiredHoldDotyposReservationIds: ["expired-dotypos-reservation-id"],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.unavailableMonitorOptions).not.toContain("2x27-qhd");
  });

  test("falls back when expired local hold filtering fails", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "profi",
      monitorOption: "2x27-qhd",
      reservations: [
        makeReservation({
          id: "expired-dotypos-reservation-id",
          tableId: "profi-27-qhd",
          status: "NEW",
        }),
      ],
      expiredHoldDotyposReservationIdsError: true,
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.unavailableMonitorOptions).toContain("2x27-qhd");
  });

  test("marks a tier unavailable only when all matching tables are occupied", async () => {
    const oneBasicOccupied = await getAvailability({
      date: testDate,
      reservations: [makeReservation({ tableId: "basic-1", status: "NEW" })],
    });

    expect(oneBasicOccupied.unavailableCoworkTiers).not.toContain("basic");

    const allBasicOccupied = await getAvailability({
      date: testDate,
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW" }),
        makeReservation({ tableId: "basic-2", status: "CONFIRMED" }),
      ],
    });

    expect(allBasicOccupied.unavailableCoworkTiers).toContain("basic");
  });

  test("keeps a table available until overlapping reservation seats reach capacity", async () => {
    const partiallyOccupied = await getAvailability({
      date: testDate,
      entryTier: "basic",
      tables: [makeTable({ id: "basic-1", tags: ["tier:basic"], seats: "2" })],
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW", seats: "1" }),
      ],
    });

    expect(partiallyOccupied.unavailableDates).not.toContain(testDate);
    expect(partiallyOccupied.unavailableCoworkTiers).not.toContain("basic");

    const fullyOccupied = await getAvailability({
      date: testDate,
      entryTier: "basic",
      tables: [makeTable({ id: "basic-1", tags: ["tier:basic"], seats: "2" })],
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW", seats: "1" }),
        makeReservation({
          tableId: "basic-1",
          status: "CONFIRMED",
          seats: "1",
        }),
      ],
    });

    expect(fullyOccupied.unavailableDates).toContain(testDate);
    expect(fullyOccupied.unavailableCoworkTiers).toContain("basic");
  });

  test("marks a meeting room unavailable after any overlapping booking", async () => {
    const availability = await getAvailability({
      date: testDate,
      _tag: "meeting-room",
      tables: [
        makeTable({
          id: "room-1",
          tags: ["reservation:meeting-room"],
          seats: "12",
        }),
      ],
      reservations: [
        makeReservation({ tableId: "room-1", status: "NEW", seats: "1" }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.meetingRoomUnavailable).toBe(true);
  });

  test("keeps non-selected range dates unavailable for cowork date picker", async () => {
    const availability = await getAvailability({
      date: testDate,
      to: nextTestDate,
      entryTier: "basic",
      tables: [makeTable({ id: "basic-1", tags: ["tier:basic"] })],
      reservations: [
        makeReservation({
          tableId: "basic-1",
          status: "NEW",
          startDate: "2099-06-10T22:00:00Z",
          endDate: "2099-06-11T22:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.unavailableDates).toContain(nextTestDate);
  });

  test("uses half-open interval overlap for selected availability", async () => {
    const backToBack = await getAvailability({
      _tag: "meeting-room",
      date: testDate,
      startsAt: "14:00",
      endsAt: "16:00",
      tables: [makeTable({ id: "room-1", tags: ["reservation:meeting-room"] })],
      reservations: [
        makeReservation({
          tableId: "room-1",
          status: "NEW",
          startDate: "2099-06-10T06:00:00Z",
          endDate: "2099-06-10T12:00:00Z",
        }),
      ],
    });

    expect(backToBack.unavailableDates).not.toContain(testDate);
    expect(backToBack.meetingRoomUnavailable).toBe(false);

    const overlapping = await getAvailability({
      _tag: "meeting-room",
      date: testDate,
      startsAt: "14:00",
      endsAt: "16:00",
      tables: [makeTable({ id: "room-1", tags: ["reservation:meeting-room"] })],
      reservations: [
        makeReservation({
          tableId: "room-1",
          status: "NEW",
          startDate: "2099-06-10T13:00:00Z",
          endDate: "2099-06-10T15:00:00Z",
        }),
      ],
    });

    expect(overlapping.unavailableDates).toContain(testDate);
    expect(overlapping.meetingRoomUnavailable).toBe(true);
  });

  test("ignores inactive, hidden, and untagged tables", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: [
        makeTable({ id: "hidden", tags: ["tier:basic"], display: false }),
        makeTable({ id: "disabled", tags: ["tier:basic"], enabled: false }),
        makeTable({ id: "online", tags: [] }),
      ],
    });

    expect(availability.unavailableCoworkTiers).toContain("basic");
  });

  test("marks calendar fully occupied dates unavailable", async () => {
    const availability = await getAvailability({
      date: testDate,
      limitations: [
        WorkspaceCalendarLimitation.FullyOccupied({
          date: testDate,
          sourceEventId: "calendar-full",
        }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.notices).toEqual([]);
  });

  test("returns calendar partial occupancy notices without blocking reservations", async () => {
    const availability = await getAvailability({
      date: testDate,
      limitations: [
        WorkspaceCalendarLimitation.PartiallyOccupied({
          date: testDate,
          startsAt: "14:00",
          endsAt: "17:00",
          sourceEventId: "calendar-partial",
          summary: "Community meetup [workspace:partial]",
        }),
      ],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.notices).toEqual([
      {
        date: testDate,
        startsAt: "14:00",
        endsAt: "17:00",
        summary: "Community meetup [workspace:partial]",
      },
    ]);
  });

  test("fails ensureAvailable when selected setup is occupied", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "cowork",
            date: testDate,
            entryTier: "profi",
            monitorOption: "2x27-qhd",
          });
        })
      ),
      {
        reservations: [
          makeReservation({ tableId: "profi-27-qhd", status: "NEW" }),
        ],
      }
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("WorkspaceTableUnavailableError");
      expect(result.failure.reservation).toEqual({
        _tag: "cowork",
        tier: "profi",
        monitorOption: "2x27-qhd",
      });
    }
  });

  test("describes an unavailable meeting-room reservation with its tag", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "meeting-room",
            date: testDate,
          });
        })
      ),
      {
        tables: [
          makeTable({
            id: "room-1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        reservations: [
          makeReservation({ tableId: "room-1", status: "NEW", seats: "1" }),
        ],
      }
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.reservation).toEqual({ _tag: "meeting-room" });
    }
  });

  test("fails ensureAvailable when calendar marks the date fully occupied", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "cowork",
            date: testDate,
            entryTier: "basic",
          });
        })
      ),
      {
        limitations: [
          WorkspaceCalendarLimitation.FullyOccupied({
            date: testDate,
            sourceEventId: "calendar-full",
          }),
        ],
      }
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("WorkspaceTableUnavailableError");
      expect(result.failure.reservation).toEqual({
        _tag: "cowork",
        tier: "basic",
      });
    }
  });

  test("fails ensureAvailable when an overnight interval touches a fully occupied date", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "meeting-room",
            date: testDate,
            startsAt: "22:00",
            endsAt: "02:00",
          });
        })
      ),
      {
        tables: [
          makeTable({ id: "room-1", tags: ["reservation:meeting-room"] }),
        ],
        limitations: [
          WorkspaceCalendarLimitation.FullyOccupied({
            date: nextTestDate,
            sourceEventId: "calendar-full-next-day",
          }),
        ],
      }
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("WorkspaceTableUnavailableError");
      expect(result.failure.date).toBe(nextTestDate);
      expect(result.failure.reservation).toEqual({ _tag: "meeting-room" });
    }
  });

  test("does not shift overnight availability checks onto the following night", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "meeting-room",
            date: testDate,
            startsAt: "22:00",
            endsAt: "02:00",
          });
        })
      ),
      {
        tables: [
          makeTable({ id: "room-1", tags: ["reservation:meeting-room"] }),
        ],
        reservations: [
          makeReservation({
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-11T20:00:00Z",
            endDate: "2099-06-12T00:00:00Z",
          }),
        ],
      }
    );

    expect(result._tag).toBe("Success");
  });

  test("ignores reservations after a multi-day meeting-room interval", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            _tag: "meeting-room",
            date: testDate,
            startsAt: "10:00",
            endsAt: "10:00",
          });
        })
      ),
      {
        tables: [
          makeTable({
            id: "room-1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        reservations: [
          makeReservation({
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-11T12:00:00Z",
            endDate: "2099-06-11T13:00:00Z",
          }),
        ],
      }
    );

    expect(result._tag).toBe("Success");
  });
});
