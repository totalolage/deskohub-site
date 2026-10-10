import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationInterval,
  DotyposService,
} from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceProductMonitorOption } from "@/features/reservation/cowork-reservation-product";
import {
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";

type DotyposAssignmentTestService = typeof DotyposService.Service;

type MakeCoworkReservationInput =
  | {
      readonly entryTier?: "basic";
      readonly coffee?: boolean;
      readonly date?: string;
    }
  | {
      readonly entryTier: "open-space";
      readonly coffee?: boolean;
      readonly date?: string;
    }
  | {
      readonly entryTier: "reserved-desk";
      readonly date?: string;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | { readonly entryTier: "plus"; readonly date?: string }
  | {
      readonly entryTier: "profi";
      readonly date?: string;
      readonly monitorOption: WorkspaceProductMonitorOption;
    };

const makeReservation = (
  input: MakeCoworkReservationInput = {}
): WorkspaceTableAssignmentReservation => {
  const date = input.date ?? "2099-06-10";

  if (input.entryTier === "open-space") {
    return {
      kind: "cowork",
      entryTier: "open-space",
      coffee: input.coffee ?? false,
      date,
    };
  }

  if (input.entryTier === "reserved-desk") {
    return {
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      date,
      ...(input.monitorOption && { monitorOption: input.monitorOption }),
    };
  }

  if (input.entryTier === "plus") {
    return { kind: "cowork", entryTier: "plus", coffee: true, date };
  }

  if (input.entryTier === "profi") {
    return {
      kind: "cowork",
      entryTier: "profi",
      coffee: true,
      date,
      monitorOption: input.monitorOption,
    };
  }

  return {
    kind: "cowork",
    entryTier: "basic",
    coffee: input.coffee ?? false,
    date,
  };
};

const makeMeetingRoomReservation = (
  overrides: { readonly startsAt?: string; readonly endsAt?: string } = {}
): WorkspaceTableAssignmentReservation => ({
  kind: "meeting-room",
  duration: { unit: "hour", amount: 1 },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T07:00:00Z",
  endsAt: "2099-06-10T08:00:00Z",
  ...overrides,
});

const makeOfficeReservation = (
  overrides: {
    readonly startsOn?: string;
    readonly endsOn?: string;
    readonly seats?: number;
  } = {}
): WorkspaceTableAssignmentReservation => ({
  kind: "office",
  startsOn: "2099-06-10",
  endsOn: "2099-06-10",
  seats: 2,
  ...overrides,
});

const makeTable = (input: {
  readonly id?: string;
  readonly name: string;
  readonly tags?: string[];
  readonly seats?: string;
  readonly positionX?: string;
  readonly positionY?: string;
  readonly locationName?: string;
  readonly display?: boolean;
  readonly enabled?: boolean;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  seats: "1",
  ...input,
});

const makeDotyposReservation = (input: {
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
  startDate: input.startDate ?? "2099-06-09T22:00:00Z",
  endDate: input.endDate ?? "2099-06-10T22:00:00Z",
  seats: input.seats ?? "1",
  status: input.status,
});

const assignTableId = (
  reservation: WorkspaceTableAssignmentReservation,
  tables: readonly Table[],
  dotyposReservations: readonly Reservation[] = [],
  expiredHoldDotyposReservationIds: readonly string[] = [],
  onReservationInterval?: (interval: DotyposReservationInterval) => void
) => {
  const dotyposService: DotyposAssignmentTestService = {
    createReservation: mock(() => Effect.die("createReservation not mocked")),
    getReservation: mock(() => Effect.die("getReservation not mocked")),
    getCustomer: mock(() => Effect.die("getCustomer not mocked")),
    findCustomer: mock(() => Effect.die("findCustomer not mocked")),
    findOrCreateCustomer: mock(() =>
      Effect.die("findOrCreateCustomer not mocked")
    ),
    getCustomerDiscount: mock(() =>
      Effect.die("getCustomerDiscount not mocked")
    ),
    getTables: mock(() => Effect.succeed([...tables])),
    listActiveReservationsOverlapping: mock((interval) => {
      onReservationInterval?.(interval);
      return Effect.succeed([...dotyposReservations]);
    }),
    listReservations: mock(() => Effect.succeed([...dotyposReservations])),
    getProducts: mock(() => Effect.die("getProducts not mocked")),
    getCategories: mock(() => Effect.die("getCategories not mocked")),
  };

  return Effect.gen(function* () {
    const service = yield* WorkspaceTableAssignmentService;
    return yield* service.assignTableId(reservation);
  }).pipe(
    Effect.provide(
      WorkspaceTableAssignmentService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(DotyposService, dotyposService),
            Layer.succeed(WorkspaceReservationRepository, {
              selectExpiredHoldDotyposReservationIds: mock(() =>
                Effect.succeed([...expiredHoldDotyposReservationIds])
              ),
            } as never)
          )
        )
      )
    ),
    Effect.runPromise
  );
};

describe("WorkspaceTableAssignmentService", () => {
  test("loads only reservations overlapping the exact meeting-room interval", async () => {
    let interval: DotyposReservationInterval | undefined;

    await assignTableId(
      makeMeetingRoomReservation({
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T11:00:00Z",
      }),
      [
        makeTable({
          id: "meeting-room",
          name: "Meeting room",
          tags: ["reservation:meeting-room"],
        }),
      ],
      [],
      [],
      (value) => {
        interval = value;
      }
    );

    expect(interval?.startDate.toISOString()).toBe("2099-06-10T07:00:00.000Z");
    expect(interval?.endDate.toISOString()).toBe("2099-06-10T11:00:00.000Z");
  });

  test("uses Prague day bounds for cowork inventory across DST", async () => {
    let interval: DotyposReservationInterval | undefined;

    await assignTableId(
      makeReservation({ date: "2026-10-25" }),
      [
        makeTable({
          id: "basic",
          name: "Basic",
          tags: ["tier:basic"],
        }),
      ],
      [],
      [],
      (value) => {
        interval = value;
      }
    );

    expect(interval?.startDate.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(interval?.endDate.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  test("uses the tier reservation interval as cowork occupancy input across DST", async () => {
    const captureInterval = () => {
      let interval: DotyposReservationInterval | undefined;
      return {
        get interval() {
          return interval;
        },
        capture: (value: DotyposReservationInterval) => {
          interval = value;
        },
      };
    };
    const openSpace = captureInterval();

    await assignTableId(
      makeReservation({ entryTier: "open-space", date: "2026-10-25" }),
      [
        makeTable({
          id: "open-1",
          name: "Open 1",
          tags: ["cowork:open-space"],
        }),
      ],
      [],
      [],
      openSpace.capture
    );

    expect(openSpace.interval?.startDate.toISOString()).toBe(
      "2026-10-24T22:00:00.000Z"
    );
    expect(openSpace.interval?.endDate.toISOString()).toBe(
      "2026-10-25T16:00:00.000Z"
    );

    const reservedDesk = captureInterval();

    await assignTableId(
      makeReservation({ entryTier: "reserved-desk", date: "2026-10-25" }),
      [
        makeTable({
          id: "desk-1",
          name: "Desk 1",
          tags: ["cowork:reserved-desk"],
        }),
      ],
      [],
      [],
      reservedDesk.capture
    );

    expect(reservedDesk.interval?.startDate.toISOString()).toBe(
      "2026-10-24T22:00:00.000Z"
    );
    expect(reservedDesk.interval?.endDate.toISOString()).toBe(
      "2026-10-25T23:00:00.000Z"
    );
  });

  test("does not consume open-space assignment capacity for an after-17:00 reservation", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T16:00:00Z",
            endDate: "2099-06-10T18:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("open-1");
  });

  test("consumes open-space assignment capacity for an overlapping morning reservation", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T06:00:00Z",
            endDate: "2099-06-10T08:00:00Z",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: cowork:open-space"
    );
  });

  test("reports a full table as unavailable capacity rather than invalid input", async () => {
    // Late-payment recovery refunds on this outcome, so it must stay
    // distinguishable from provider validation failures that are retried.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T06:00:00Z",
            endDate: "2099-06-10T08:00:00Z",
          }),
        ]
      )
    ).rejects.toMatchObject({
      _tag: "TableAssignmentUnavailableError",
      requiredTags: ["cowork:open-space"],
    });
  });

  test("keeps the 17:00 half-open boundary parity on the assignment path", async () => {
    // A reservation starting exactly at 17:00 Prague does not occupy the
    // 00:00-17:00 exclusive-end open-space interval.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "NEW",
            startDate: "2099-06-10T15:00:00Z",
            endDate: "2099-06-10T18:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("open-1");

    // A reservation ending exactly at 17:00 Prague still occupies the
    // 00:00-17:00 interval up to its exclusive end.
    await expect(
      assignTableId(
        makeReservation({ entryTier: "open-space" }),
        [
          makeTable({
            id: "open-1",
            name: "Open 1",
            tags: ["cowork:open-space"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-1",
            status: "NEW",
            startDate: "2099-06-10T14:00:00Z",
            endDate: "2099-06-10T15:00:00Z",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: cowork:open-space"
    );
  });

  test("blocks a reserved-desk assignment for an after-17:00 occupancy", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "desk-1",
            name: "Desk 1",
            tags: ["cowork:reserved-desk"],
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "desk-1",
            status: "CONFIRMED",
            startDate: "2099-06-10T16:00:00Z",
            endDate: "2099-06-10T18:00:00Z",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: cowork:reserved-desk"
    );
  });

  test("matches Profi 2x27 QHD by tier and monitor tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          entryTier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({
            id: "wrong-resolution",
            name: "3",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:4k",
            ],
          }),
          makeTable({
            id: "qhd-27",
            name: "1",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:qhd",
            ],
          }),
        ]
      )
    ).resolves.toBe("qhd-27");
  });

  test("matches Profi 2x32 4K by tier and monitor tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          entryTier: "profi",
          monitorOption: "2x32-4k",
        }),
        [
          makeTable({
            id: "qhd-32",
            name: "2",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:32",
              "monitor:resolution:qhd",
            ],
          }),
          makeTable({
            id: "4k-32",
            name: "4",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:32",
              "monitor:resolution:4k",
            ],
          }),
        ]
      )
    ).resolves.toBe("4k-32");
  });

  test("selects Basic and Plus matches deterministically by natural table name then id", async () => {
    await expect(
      assignTableId(makeReservation({ entryTier: "basic" }), [
        makeTable({ id: "basic-10", name: "10", tags: ["tier:basic"] }),
        makeTable({ id: "basic-b", name: "2", tags: ["tier:basic"] }),
        makeTable({ id: "basic-a", name: "2", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("basic-a");

    await expect(
      assignTableId(makeReservation({ entryTier: "plus" }), [
        makeTable({ id: "plus-7", name: "7", tags: ["tier:plus"] }),
        makeTable({ id: "plus-5", name: "5", tags: ["tier:plus"] }),
        makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("plus-5");
  });

  test("skips an occupied matching table and assigns the next free matching table", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
          makeTable({ id: "basic-2", name: "2", tags: ["tier:basic"] }),
        ],
        [makeDotyposReservation({ tableId: "basic-1", status: "NEW" })]
      )
    ).resolves.toBe("basic-2");
  });

  test("does not count back-to-back meeting-room reservations as occupied", async () => {
    await expect(
      assignTableId(
        makeMeetingRoomReservation({
          startsAt: "2099-06-10T12:00:00Z",
          endsAt: "2099-06-10T13:00:00Z",
        }),
        [
          makeTable({
            id: "room-1",
            name: "Room 1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "room-1",
            status: "NEW",
            startDate: "2099-06-10T06:00:00Z",
            endDate: "2099-06-10T12:00:00Z",
          }),
        ]
      )
    ).resolves.toBe("room-1");
  });

  test("reserves overlapping meeting-room tables exclusively", async () => {
    await expect(
      assignTableId(
        makeMeetingRoomReservation(),
        [
          makeTable({
            id: "room-1",
            name: "Room 1",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
          makeTable({
            id: "room-2",
            name: "Room 2",
            tags: ["reservation:meeting-room"],
            seats: "12",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "room-1",
            status: "NEW",
            seats: "1",
            startDate: "2099-06-10T07:30:00Z",
            endDate: "2099-06-10T08:30:00Z",
          }),
        ]
      )
    ).resolves.toBe("room-2");
  });

  test("rejects a partially occupied office despite sufficient remaining capacity", async () => {
    await expect(
      assignTableId(
        makeOfficeReservation(),
        [
          makeTable({
            id: "office",
            name: "Office",
            tags: ["reservation:office"],
            seats: "8",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "office",
            status: "CONFIRMED",
            seats: "1",
          }),
        ]
      )
    ).rejects.toThrow(
      "No available Dotypos workspace table matches tags: reservation:office"
    );
  });

  test("ignores expired local holds while assigning a table", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
          makeTable({ id: "basic-2", name: "2", tags: ["tier:basic"] }),
        ],
        [
          makeDotyposReservation({
            id: "expired-dotypos-reservation-id",
            tableId: "basic-1",
            status: "NEW",
          }),
        ],
        ["expired-dotypos-reservation-id"]
      )
    ).resolves.toBe("basic-1");
  });

  test("assigns a matching table when existing reservations leave enough capacity", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({
            id: "basic-1",
            name: "1",
            tags: ["tier:basic"],
            seats: "2",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "basic-1",
            status: "NEW",
            seats: "1",
          }),
        ]
      )
    ).resolves.toBe("basic-1");
  });

  test("chooses the highest-scoring matching table with capacity", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({
            id: "occupied",
            name: "1",
            tags: ["tier:basic"],
            positionX: "0",
            positionY: "0",
          }),
          makeTable({
            id: "near",
            name: "2",
            tags: ["tier:basic"],
            positionX: "1",
            positionY: "0",
          }),
          makeTable({
            id: "far",
            name: "3",
            tags: ["tier:basic"],
            positionX: "10",
            positionY: "0",
          }),
        ],
        [makeDotyposReservation({ tableId: "occupied", status: "CONFIRMED" })]
      )
    ).resolves.toBe("far");
  });

  test("ranks Reserved Desk away from an otherwise empty Open Space table", async () => {
    await expect(
      assignTableId(makeReservation({ entryTier: "reserved-desk" }), [
        makeTable({
          id: "open-space",
          name: "1 Open Space",
          tags: ["cowork:open-space"],
          seats: "4",
          positionX: "0",
          positionY: "0",
          locationName: "main",
        }),
        makeTable({
          id: "reserved-near",
          name: "2 Reserved Near",
          tags: ["cowork:reserved-desk"],
          seats: "2",
          positionX: "1",
          positionY: "0",
          locationName: "main",
        }),
        makeTable({
          id: "reserved-far",
          name: "3 Reserved Far",
          tags: ["cowork:reserved-desk"],
          seats: "2",
          positionX: "10",
          positionY: "0",
          locationName: "main",
        }),
      ])
    ).resolves.toBe("reserved-far");
  });

  test("weights Open Space ranking by max(actual occupancy, seat capacity)", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "open-high-capacity",
            name: "1 Open High Capacity",
            tags: ["cowork:open-space"],
            seats: "4",
            positionX: "0",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "open-low-capacity",
            name: "2 Open Low Capacity",
            tags: ["cowork:open-space"],
            seats: "1",
            positionX: "10",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-high-capacity",
            name: "3 Reserved Near High Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "2.4",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-low-capacity",
            name: "4 Reserved Near Low Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "2.0",
            positionY: "0",
            locationName: "main",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-high-capacity",
            status: "CONFIRMED",
            seats: "3",
          }),
        ]
      )
    ).resolves.toBe("reserved-near-high-capacity");
  });

  test("preserves actual Open Space occupancy above its configured capacity for ranking", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "open-high-capacity",
            name: "1 Open High Capacity",
            tags: ["cowork:open-space"],
            seats: "4",
            positionX: "0",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "open-low-capacity",
            name: "2 Open Low Capacity",
            tags: ["cowork:open-space"],
            seats: "1",
            positionX: "10",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-high-capacity",
            name: "3 Reserved Near High Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "1.7",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "reserved-near-low-capacity",
            name: "4 Reserved Near Low Capacity",
            tags: ["cowork:reserved-desk"],
            seats: "2",
            positionX: "1.3",
            positionY: "0",
            locationName: "main",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "open-high-capacity",
            status: "CONFIRMED",
            seats: "6",
          }),
        ]
      )
    ).resolves.toBe("reserved-near-high-capacity");
  });

  test("keeps a dual-tag Reserved Desk assignable using actual remaining capacity", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "reserved-desk" }),
        [
          makeTable({
            id: "dual-tag",
            name: "Dual-tag table",
            tags: ["cowork:open-space", "cowork:reserved-desk"],
            seats: "2",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "dual-tag",
            status: "CONFIRMED",
            seats: "1",
          }),
        ]
      )
    ).resolves.toBe("dual-tag");
  });

  test("scores against non-matching same-room workspace tables", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({
            id: "occupied-plus",
            name: "1",
            tags: ["tier:plus"],
            positionX: "0",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "near-basic",
            name: "2",
            tags: ["tier:basic"],
            positionX: "1",
            positionY: "0",
            locationName: "main",
          }),
          makeTable({
            id: "far-basic",
            name: "3",
            tags: ["tier:basic"],
            positionX: "10",
            positionY: "0",
            locationName: "main",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "occupied-plus",
            status: "CONFIRMED",
          }),
        ]
      )
    ).resolves.toBe("far-basic");
  });

  test("chooses an unoccupied table over a farther partially occupied table", async () => {
    await expect(
      assignTableId(
        makeReservation({ entryTier: "basic", date: "2099-06-10" }),
        [
          makeTable({
            id: "occupied-reference",
            name: "1",
            tags: ["tier:basic"],
            positionX: "0",
            positionY: "0",
          }),
          makeTable({
            id: "near-unoccupied",
            name: "2",
            tags: ["tier:basic"],
            positionX: "0",
            positionY: "0",
          }),
          makeTable({
            id: "far-partially-occupied",
            name: "3",
            tags: ["tier:basic"],
            seats: "2",
            positionX: "10",
            positionY: "0",
          }),
        ],
        [
          makeDotyposReservation({
            tableId: "occupied-reference",
            status: "CONFIRMED",
          }),
          makeDotyposReservation({
            tableId: "far-partially-occupied",
            status: "CONFIRMED",
          }),
        ]
      )
    ).resolves.toBe("near-unoccupied");
  });

  test("ignores hidden, disabled, missing-id, inactive-flag, and unlabeled active visible virtual tables", async () => {
    await expect(
      assignTableId(makeReservation({ entryTier: "basic" }), [
        makeTable({ id: "online", name: "Online reservation", tags: [] }),
        {
          _cloudId: "cloud",
          id: "missing-display-enabled",
          name: "0",
          tags: ["tier:basic"],
        } satisfies Table,
        makeTable({
          id: "hidden",
          name: "1",
          tags: ["tier:basic"],
          display: false,
        }),
        makeTable({
          id: "disabled",
          name: "2",
          tags: ["tier:basic"],
          enabled: false,
        }),
        makeTable({ id: "", name: "3", tags: ["tier:basic"] }),
        makeTable({ name: "4", tags: ["tier:basic"] }),
        makeTable({ id: "basic-8", name: "8", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("basic-8");
  });

  test("fails clearly when no active visible table matches all required tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          entryTier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({ id: "profi-only", name: "1", tags: ["tier:profi"] }),
          makeTable({
            id: "qhd-only",
            name: "2",
            tags: ["monitor:resolution:qhd"],
          }),
        ]
      )
    ).rejects.toThrow("No active visible Dotypos workspace table matches tags");
  });
});
