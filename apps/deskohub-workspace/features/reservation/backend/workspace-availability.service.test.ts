import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationInterval,
  DotyposService,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
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
  makeTable({ id: "basic-1", tags: ["tier:basic", "cowork:open-space"] }),
  makeTable({ id: "basic-2", tags: ["tier:basic", "cowork:open-space"] }),
  makeTable({ id: "plus-1", tags: ["tier:plus"] }),
  makeTable({
    id: "profi-27-qhd",
    tags: [
      "tier:profi",
      "cowork:reserved-desk",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:qhd",
    ],
  }),
  makeTable({
    id: "profi-32-qhd",
    tags: [
      "tier:profi",
      "cowork:reserved-desk",
      "monitor:count:2",
      "monitor:size:32",
      "monitor:resolution:qhd",
    ],
  }),
  makeTable({
    id: "profi-27-4k",
    tags: [
      "tier:profi",
      "cowork:reserved-desk",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:4k",
    ],
  }),
  makeTable({
    id: "profi-32-4k",
    tags: [
      "tier:profi",
      "cowork:reserved-desk",
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
    readonly onReservationInterval?: (
      interval: DotyposReservationInterval
    ) => void;
  } = {}
) => {
  const availability = await import("./workspace-availability.service");

  return effect.pipe(
    Effect.provide(
      availability.WorkspaceAvailabilityService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DotyposService, {
              getTables: mock(() =>
                Effect.succeed([...(input.tables ?? defaultTables)])
              ),
              listActiveReservationsOverlapping: mock((interval) => {
                input.onReservationInterval?.(interval);
                // The real Dotypos API only returns reservations overlapping
                // the requested interval; mirror that so a wrongly narrowed
                // inventory request cannot silently pass these tests.
                const intervalStart = interval.startDate.getTime();
                const intervalEnd = interval.endDate.getTime();
                return Effect.succeed(
                  (input.reservations ?? []).filter((reservation) => {
                    const start = new Date(reservation.startDate).getTime();
                    const end = new Date(reservation.endDate).getTime();
                    return start < intervalEnd && end > intervalStart;
                  })
                );
              }),
            }),
            Layer.succeed(GoogleCalendarWorkspaceLimitationsService, {
              listLimitations: mock(() =>
                Effect.succeed([...(input.limitations ?? [])])
              ),
            }),
            Layer.succeed(WorkspaceReservationRepository, {
              selectExpiredHoldDotyposReservationIds: mock(() => {
                if (input.expiredHoldDotyposReservationIdsError) {
                  return Effect.fail(
                    new EffectDrizzleQueryError({
                      query:
                        "workspaceReservations.selectExpiredHoldDotyposReservationIds",
                      params: [],
                      cause: new Error("expired hold filter failed"),
                    })
                  );
                }

                return Effect.succeed([
                  ...(input.expiredHoldDotyposReservationIds ?? []),
                ]);
              }),
            } as never)
          )
        )
      )
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
  readonly kind?: "cowork" | "meeting-room" | "office";
  readonly seats?: number;
  readonly entryTier?: "open-space" | "reserved-desk";
  readonly monitorOption?: "2x27-qhd" | "2x32-qhd" | "2x27-4k" | "2x32-4k";
  readonly tables?: readonly Table[];
  readonly reservations?: readonly Reservation[];
  readonly expiredHoldDotyposReservationIds?: readonly string[];
  readonly expiredHoldDotyposReservationIdsError?: boolean;
  readonly limitations?: readonly WorkspaceCalendarLimitationType[];
  readonly onReservationInterval?: (
    interval: DotyposReservationInterval
  ) => void;
}) =>
  runWithInventory(
    Effect.gen(function* () {
      const availability = yield* Effect.promise(
        () => import("./workspace-availability.service")
      );
      const service = yield* availability.WorkspaceAvailabilityService;
      const baseQuery = {
        from: input.from ?? testDate,
        to: input.to ?? testDate,
      };

      if (input.kind === "meeting-room") {
        return yield* service.getAvailability({
          query: {
            ...baseQuery,
            kind: "meeting-room",
            startsAt: input.startsAt,
            endsAt: input.endsAt,
          },
        });
      }

      if (input.kind === "office") {
        return yield* service.getAvailability({
          query: {
            ...baseQuery,
            kind: "office",
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            seats: input.seats,
          },
        });
      }

      return yield* service.getAvailability({
        query: {
          ...baseQuery,
          kind: "cowork",
          date: input.date,
          entryTier: input.entryTier,
          monitorOption: input.monitorOption,
        },
      });
    }),
    input
  );

const getReplacementAvailability = (input: {
  readonly excludedDotyposReservationId: string;
  readonly entryTier?: "open-space" | "reserved-desk";
  readonly reservations: readonly Reservation[];
  readonly tables: readonly Table[];
}) =>
  runWithInventory(
    Effect.gen(function* () {
      const availability = yield* Effect.promise(
        () => import("./workspace-availability.service")
      );
      const service = yield* availability.WorkspaceAvailabilityService;
      return yield* service.getAvailability({
        query: {
          kind: "cowork",
          from: testDate,
          to: testDate,
          date: testDate,
          entryTier: input.entryTier ?? "open-space",
        },
        occupancyExclusion: {
          dotyposReservationId: input.excludedDotyposReservationId,
        },
      });
    }),
    input
  );

describe("WorkspaceAvailabilityService", () => {
  test("returns no workstation requirement dates for a meeting room query", async () => {
    const availability = await getAvailability({
      kind: "meeting-room",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T09:00:00Z",
    });

    expect(availability.reservedDeskWorkstationRequiredDates).toEqual([]);
  });

  test("fails when an eligible table has an invalid seat capacity", async () => {
    await expect(
      getAvailability({
        date: testDate,
        entryTier: "open-space",
        tables: [
          makeTable({
            id: "invalid-basic",
            tags: ["tier:basic", "cowork:open-space"],
            seats: "not-a-number",
          }),
        ],
      })
    ).rejects.toMatchObject({ _tag: "ValidationError" });
  });

  test("loads only the active reservation interval covering Prague dates", async () => {
    let interval: DotyposReservationInterval | undefined;

    await getAvailability({
      from: "2026-03-29",
      onReservationInterval: (value) => {
        interval = value;
      },
      to: "2026-03-29",
    });

    expect(interval?.startDate.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(interval?.endDate.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  test("counts NEW reservations as occupied for selected monitor setup dates", async () => {
    const availability = await getAvailability({
      entryTier: "reserved-desk",
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
      entryTier: "reserved-desk",
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
      entryTier: "reserved-desk",
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

  test("excludes only the verified replacement hold from occupancy", async () => {
    const ownReservation = makeReservation({
      id: "own-dotypos-reservation-id",
      tableId: "basic-1",
      status: "NEW",
    });
    const tables = [
      makeTable({ id: "basic-1", tags: ["tier:basic", "cowork:open-space"] }),
    ];

    const onlyOwnHold = await getReplacementAvailability({
      excludedDotyposReservationId: "own-dotypos-reservation-id",
      reservations: [ownReservation],
      tables,
    });

    expect(onlyOwnHold.unavailableDates).not.toContain(testDate);
    expect(onlyOwnHold.unavailableCoworkTiers).not.toContain("open-space");

    const anotherHoldRemains = await getReplacementAvailability({
      excludedDotyposReservationId: "own-dotypos-reservation-id",
      reservations: [
        ownReservation,
        makeReservation({
          id: "another-dotypos-reservation-id",
          tableId: "basic-1",
          status: "NEW",
        }),
      ],
      tables,
    });

    expect(anotherHoldRemains.unavailableDates).toContain(testDate);
    expect(anotherHoldRemains.unavailableCoworkTiers).toContain("open-space");
  });

  test("does not exclude a replacement reservation that is no longer pending", async () => {
    const availability = await getReplacementAvailability({
      excludedDotyposReservationId: "confirmed-dotypos-reservation-id",
      reservations: [
        makeReservation({
          id: "confirmed-dotypos-reservation-id",
          tableId: "basic-1",
          status: "CONFIRMED",
        }),
      ],
      tables: [
        makeTable({ id: "basic-1", tags: ["tier:basic", "cowork:open-space"] }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.unavailableCoworkTiers).toContain("open-space");
  });

  test("falls back when expired local hold filtering fails", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
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

    expect(oneBasicOccupied.unavailableCoworkTiers).not.toContain("open-space");

    const allBasicOccupied = await getAvailability({
      date: testDate,
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW" }),
        makeReservation({ tableId: "basic-2", status: "CONFIRMED" }),
      ],
    });

    expect(allBasicOccupied.unavailableCoworkTiers).toContain("open-space");
  });

  test("keeps a table available until overlapping reservation seats reach capacity", async () => {
    const partiallyOccupied = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: [
        makeTable({
          id: "basic-1",
          tags: ["tier:basic", "cowork:open-space"],
          seats: "2",
        }),
      ],
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW", seats: "1" }),
      ],
    });

    expect(partiallyOccupied.unavailableDates).not.toContain(testDate);
    expect(partiallyOccupied.unavailableCoworkTiers).not.toContain(
      "open-space"
    );

    const fullyOccupied = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: [
        makeTable({
          id: "basic-1",
          tags: ["tier:basic", "cowork:open-space"],
          seats: "2",
        }),
      ],
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
    expect(fullyOccupied.unavailableCoworkTiers).toContain("open-space");
  });

  test("marks an office unavailable after any overlapping occupancy", async () => {
    const officeTable = makeTable({
      id: "office",
      tags: ["reservation:office"],
      seats: "8",
    });
    const query = {
      kind: "office" as const,
      startsAt: testStart,
      endsAt: testEnd,
      seats: 2,
      tables: [officeTable],
    };

    const empty = await getAvailability(query);
    const partiallyOccupied = await getAvailability({
      ...query,
      reservations: [
        makeReservation({
          tableId: "office",
          status: "CONFIRMED",
          seats: "1",
        }),
      ],
    });

    expect(empty.officeUnavailable).toBe(false);
    expect(partiallyOccupied.officeUnavailable).toBe(true);
  });

  test("returns occupied office dates without a selected interval or seats", async () => {
    const availability = await getAvailability({
      kind: "office",
      from: testDate,
      to: nextTestDate,
      tables: [
        makeTable({
          id: "office",
          tags: ["reservation:office"],
          seats: "8",
        }),
      ],
      reservations: [
        makeReservation({
          tableId: "office",
          status: "CONFIRMED",
          seats: "1",
          startDate: "2099-06-10T22:00:00Z",
          endDate: "2099-06-11T22:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.unavailableDates).toContain(nextTestDate);
  });

  test("marks a meeting room unavailable after any overlapping booking", async () => {
    const availability = await getAvailability({
      kind: "meeting-room",
      startsAt: "2099-06-10T08:00:00Z",
      endsAt: "2099-06-10T09:00:00Z",
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
      entryTier: "open-space",
      tables: [
        makeTable({ id: "basic-1", tags: ["tier:basic", "cowork:open-space"] }),
      ],
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
      kind: "meeting-room",
      startsAt: "2099-06-10T12:00:00Z",
      endsAt: "2099-06-10T14:00:00Z",
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
      kind: "meeting-room",
      startsAt: "2099-06-10T12:00:00Z",
      endsAt: "2099-06-10T14:00:00Z",
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
        makeTable({
          id: "hidden",
          tags: ["tier:basic", "cowork:open-space"],
          display: false,
        }),
        makeTable({
          id: "disabled",
          tags: ["tier:basic", "cowork:open-space"],
          enabled: false,
        }),
        makeTable({ id: "online", tags: [] }),
      ],
    });

    expect(availability.unavailableCoworkTiers).toContain("open-space");
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
            kind: "cowork",
            date: testDate,
            entryTier: "reserved-desk",
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
        kind: "cowork",
        entryTier: "reserved-desk",
        monitorOption: "2x27-qhd",
      });
    }
  });

  test("rejects an occupied historical Profi monitor setup while another setup is free", async () => {
    const results = await runWithInventory(
      Effect.gen(function* () {
        const availability = yield* Effect.promise(
          () => import("./workspace-availability.service")
        );
        const service = yield* availability.WorkspaceAvailabilityService;
        const purchasedSetup = yield* Effect.result(
          service.ensureAvailable({
            kind: "cowork",
            date: testDate,
            entryTier: "profi",
            monitorOption: "2x27-qhd",
          })
        );
        const availableAlternative = yield* Effect.result(
          service.ensureAvailable({
            kind: "cowork",
            date: testDate,
            entryTier: "profi",
            monitorOption: "2x32-qhd",
          })
        );

        return { purchasedSetup, availableAlternative };
      }),
      {
        reservations: [
          makeReservation({ tableId: "profi-27-qhd", status: "NEW" }),
        ],
      }
    );

    expect(results.purchasedSetup._tag).toBe("Failure");
    if (results.purchasedSetup._tag === "Failure") {
      expect(results.purchasedSetup.failure._tag).toBe(
        "WorkspaceTableUnavailableError"
      );
      expect(results.purchasedSetup.failure.reservation).toEqual({
        kind: "cowork",
        entryTier: "profi",
        monitorOption: "2x27-qhd",
      });
    }
    expect(results.availableAlternative._tag).toBe("Success");
  });

  test("describes an unavailable meeting-room reservation with its kind", async () => {
    const result = await runWithInventory(
      Effect.result(
        Effect.gen(function* () {
          const availability = yield* Effect.promise(
            () => import("./workspace-availability.service")
          );
          const service = yield* availability.WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
            kind: "meeting-room",
            startsAt: "2099-06-10T08:00:00Z",
            endsAt: "2099-06-10T09:00:00Z",
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
      expect(result.failure.reservation).toEqual({ kind: "meeting-room" });
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
            kind: "cowork",
            date: testDate,
            entryTier: "open-space",
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
        kind: "cowork",
        entryTier: "open-space",
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
            kind: "meeting-room",
            startsAt: "2099-06-10T20:00:00Z",
            endsAt: "2099-06-11T00:00:00Z",
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
      expect(result.failure.reservation).toEqual({ kind: "meeting-room" });
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
            kind: "meeting-room",
            startsAt: "2099-06-10T20:00:00Z",
            endsAt: "2099-06-11T00:00:00Z",
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
            kind: "meeting-room",
            startsAt: "2099-06-10T08:00:00Z",
            endsAt: "2099-06-11T08:00:00Z",
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

// Prague-local times for 2099-06-10 (CEST, UTC+2): midnight is 22:00Z of the
// previous day, 08:00 is 06:00Z, 16:00 is 14:00Z, 17:00 is 15:00Z, 18:00 is
// 16:00Z, and 20:00 is 18:00Z.
const coworkOfferTables = [
  makeTable({ id: "open-1", tags: ["cowork:open-space"] }),
  makeTable({ id: "desk-1", tags: ["cowork:reserved-desk"] }),
  makeTable({
    id: "ws-qhd",
    tags: [
      "cowork:reserved-desk",
      "monitor:count:2",
      "monitor:size:27",
      "monitor:resolution:qhd",
    ],
  }),
];

describe("WorkspaceAvailabilityService cowork offer intervals", () => {
  test("requires a workstation when a bare Reserved Desk is unavailable", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.reservedDeskWorkstationRequiredDates).toEqual([
      testDate,
    ]);
  });

  test("finds an available monitor configuration later in the catalog", async () => {
    const bareDesk = makeTable({
      id: "bare-desk",
      tags: ["cowork:reserved-desk"],
    });
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: [...defaultTables, bareDesk],
      reservations: [
        makeReservation({ tableId: "bare-desk", status: "NEW" }),
        makeReservation({ tableId: "profi-27-qhd", status: "NEW" }),
        makeReservation({ tableId: "profi-32-qhd", status: "CONFIRMED" }),
        makeReservation({ tableId: "profi-27-4k", status: "NEW" }),
      ],
    });

    expect(availability.reservedDeskWorkstationRequiredDates).toEqual([
      testDate,
    ]);
  });

  test("does not require a workstation when every exact monitor configuration is full", async () => {
    const bareDesk = makeTable({
      id: "bare-desk",
      tags: ["cowork:reserved-desk"],
    });
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: [...defaultTables, bareDesk],
      reservations: [
        makeReservation({ tableId: "bare-desk", status: "NEW" }),
        makeReservation({ tableId: "profi-27-qhd", status: "NEW" }),
        makeReservation({ tableId: "profi-32-qhd", status: "NEW" }),
        makeReservation({ tableId: "profi-27-4k", status: "NEW" }),
        makeReservation({ tableId: "profi-32-4k", status: "NEW" }),
      ],
    });

    expect(availability.reservedDeskWorkstationRequiredDates).not.toContain(
      testDate
    );
  });

  test("does not require a workstation while a bare Reserved Desk is available", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: coworkOfferTables,
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.reservedDeskWorkstationRequiredDates).not.toContain(
      testDate
    );
  });

  test("does not require a workstation on a fully occupied calendar date", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: coworkOfferTables,
      reservations: [makeReservation({ tableId: "desk-1", status: "NEW" })],
      limitations: [
        WorkspaceCalendarLimitation.FullyOccupied({
          date: testDate,
          sourceEventId: "calendar-full",
        }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
    expect(availability.reservedDeskWorkstationRequiredDates).not.toContain(
      testDate
    );
  });

  test("uses the full Reserved Desk day instead of a selected Open Space interval", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: [
        makeTable({
          id: "shared-bare-desk",
          tags: ["cowork:open-space", "cowork:reserved-desk"],
        }),
        makeTable({
          id: "workstation",
          tags: [
            "cowork:reserved-desk",
            "monitor:count:2",
            "monitor:size:27",
            "monitor:resolution:qhd",
          ],
        }),
      ],
      reservations: [
        makeReservation({
          tableId: "shared-bare-desk",
          status: "NEW",
          startDate: "2099-06-10T15:00:00Z",
          endDate: "2099-06-10T16:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableDates).not.toContain(testDate);
    expect(availability.reservedDeskWorkstationRequiredDates).toEqual([
      testDate,
    ]);
  });

  test("excludes only a replacement hold while counting unrelated Reserved Desk holds", async () => {
    const ownHold = makeReservation({
      id: "own-reservation-id",
      tableId: "desk-1",
      status: "NEW",
    });
    const input = {
      excludedDotyposReservationId: "own-reservation-id",
      entryTier: "reserved-desk" as const,
      tables: coworkOfferTables,
    };
    const onlyOwnHold = await getReplacementAvailability({
      ...input,
      reservations: [ownHold],
    });
    const unrelatedHoldRemains = await getReplacementAvailability({
      ...input,
      reservations: [
        ownHold,
        makeReservation({
          id: "unrelated-reservation-id",
          tableId: "desk-1",
          status: "NEW",
        }),
      ],
    });

    expect(onlyOwnHold.reservedDeskWorkstationRequiredDates).not.toContain(
      testDate
    );
    expect(unrelatedHoldRemains.reservedDeskWorkstationRequiredDates).toEqual([
      testDate,
    ]);
  });

  test("keeps reserved-desk available when bare desks are occupied but a workstation configuration is free", async () => {
    const bareDeskOccupied = await getAvailability({
      date: testDate,
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(bareDeskOccupied.unavailableCoworkTiers).not.toContain(
      "reserved-desk"
    );
    expect(bareDeskOccupied.unavailableMonitorOptions).not.toContain(
      "2x27-qhd"
    );
    // Configurations without any configured table stay unavailable.
    expect(bareDeskOccupied.unavailableMonitorOptions).toEqual([
      "2x32-qhd",
      "2x27-4k",
      "2x32-4k",
    ]);

    // Explicit selections against the same inventory: the selected bare
    // reserved-desk offer is unavailable, while the selected free
    // workstation configuration stays bookable on the date.
    const selectedBareDesk = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(selectedBareDesk.unavailableDates).toContain(testDate);

    const selectedWorkstation = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      monitorOption: "2x27-qhd",
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(selectedWorkstation.unavailableDates).not.toContain(testDate);

    const workstationAlsoOccupied = await getAvailability({
      date: testDate,
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
        makeReservation({
          tableId: "ws-qhd",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(workstationAlsoOccupied.unavailableCoworkTiers).toContain(
      "reserved-desk"
    );
    expect(workstationAlsoOccupied.unavailableMonitorOptions).toContain(
      "2x27-qhd"
    );
  });

  test("checks each monitor option independently against the reserved-desk interval", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "ws-qhd",
          status: "NEW",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(availability.unavailableMonitorOptions).toContain("2x27-qhd");
    expect(availability.unavailableCoworkTiers).not.toContain("reserved-desk");
  });

  test("does not let an after-17:00 open-space occupancy leak into the reserved-desk check", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T16:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).not.toContain("open-space");
    expect(availability.unavailableCoworkTiers).not.toContain("reserved-desk");
  });

  test("keeps Open Space offered for a selected reserved-desk query against evening-only Open Space occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "reserved-desk",
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T16:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).not.toContain("open-space");
    expect(availability.unavailableDates).not.toContain(testDate);
  });

  test("marks a monitor option unavailable for a selected open-space query against evening-only workstation occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "ws-qhd",
          status: "NEW",
          startDate: "2099-06-10T16:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableMonitorOptions).toContain("2x27-qhd");
    expect(availability.unavailableDates).not.toContain(testDate);
  });

  test("keeps a bare query date available when bare offers are full but a workstation configuration is free", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: coworkOfferTables,
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: testStart,
          endDate: testEnd,
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).toContain("open-space");
    expect(availability.unavailableCoworkTiers).not.toContain("reserved-desk");
    expect(availability.unavailableDates).not.toContain(testDate);
  });

  test("keeps a bare query date available when only the Open Space table has evening-only occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: [makeTable({ id: "open-1", tags: ["cowork:open-space"] })],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T16:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).not.toContain("open-space");
    expect(availability.unavailableDates).not.toContain(testDate);
  });

  test("marks a bare query date unavailable when only the Open Space table has morning-overlapping occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      tables: [makeTable({ id: "open-1", tags: ["cowork:open-space"] })],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T06:00:00Z",
          endDate: "2099-06-10T14:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).toContain("open-space");
    expect(availability.unavailableDates).toContain(testDate);
  });

  test("does not let a selected open-space interval hide a full-day reserved-desk occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: [
        makeTable({ id: "open-1", tags: ["cowork:open-space"] }),
        makeTable({ id: "desk-1", tags: ["cowork:reserved-desk"] }),
      ],
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "CONFIRMED",
          startDate: "2099-06-10T16:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableCoworkTiers).not.toContain("open-space");
    expect(availability.unavailableCoworkTiers).toContain("reserved-desk");
  });

  test("blocks each offer only within its own interval", async () => {
    const morningOnOpenSpace = await getAvailability({
      date: testDate,
      tables: [
        makeTable({ id: "open-1", tags: ["cowork:open-space"] }),
        makeTable({ id: "desk-1", tags: ["cowork:reserved-desk"] }),
      ],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T06:00:00Z",
          endDate: "2099-06-10T14:00:00Z",
        }),
      ],
    });

    expect(morningOnOpenSpace.unavailableCoworkTiers).toContain("open-space");
    expect(morningOnOpenSpace.unavailableCoworkTiers).not.toContain(
      "reserved-desk"
    );

    const morningOnReservedDesk = await getAvailability({
      date: testDate,
      tables: [
        makeTable({ id: "open-1", tags: ["cowork:open-space"] }),
        makeTable({ id: "desk-1", tags: ["cowork:reserved-desk"] }),
      ],
      reservations: [
        makeReservation({
          tableId: "desk-1",
          status: "NEW",
          startDate: "2099-06-10T06:00:00Z",
          endDate: "2099-06-10T14:00:00Z",
        }),
      ],
    });

    expect(morningOnReservedDesk.unavailableCoworkTiers).toContain(
      "reserved-desk"
    );
    expect(morningOnReservedDesk.unavailableCoworkTiers).not.toContain(
      "open-space"
    );
  });

  test("holds the 17:00 half-open boundary parity for open-space availability", async () => {
    // A reservation starting exactly at 17:00 Prague does not occupy the
    // 00:00-17:00 exclusive-end open-space interval.
    const startingAt17 = await getAvailability({
      date: testDate,
      tables: [makeTable({ id: "open-1", tags: ["cowork:open-space"] })],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T15:00:00Z",
          endDate: "2099-06-10T18:00:00Z",
        }),
      ],
    });

    expect(startingAt17.unavailableCoworkTiers).not.toContain("open-space");

    // A reservation ending exactly at 17:00 Prague still occupies the
    // 00:00-17:00 interval up to its exclusive end.
    const endingAt17 = await getAvailability({
      date: testDate,
      tables: [makeTable({ id: "open-1", tags: ["cowork:open-space"] })],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T14:00:00Z",
          endDate: "2099-06-10T15:00:00Z",
        }),
      ],
    });

    expect(endingAt17.unavailableCoworkTiers).toContain("open-space");
  });

  test("marks the selected open-space date unavailable for a morning occupancy", async () => {
    const availability = await getAvailability({
      date: testDate,
      entryTier: "open-space",
      tables: [makeTable({ id: "open-1", tags: ["cowork:open-space"] })],
      reservations: [
        makeReservation({
          tableId: "open-1",
          status: "NEW",
          startDate: "2099-06-10T06:00:00Z",
          endDate: "2099-06-10T14:00:00Z",
        }),
      ],
    });

    expect(availability.unavailableDates).toContain(testDate);
  });
});
