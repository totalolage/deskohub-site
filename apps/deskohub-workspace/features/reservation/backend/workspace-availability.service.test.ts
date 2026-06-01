import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import {
  WorkspaceAvailabilityService,
  WorkspaceAvailabilityServiceLive,
  WorkspaceTableUnavailableError,
} from "./workspace-availability.service";

const testDate = "2099-06-10";
const testStart = "2099-06-09T22:00:00Z";
const testEnd = "2099-06-10T22:00:00Z";

const makeTable = (input: {
  readonly id: string;
  readonly tags: readonly string[];
  readonly name?: string;
  readonly display?: boolean;
  readonly enabled?: boolean;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  name: input.name ?? input.id,
  ...input,
  tags: [...input.tags],
});

const makeReservation = (input: {
  readonly tableId: string;
  readonly status: Reservation["status"];
  readonly startDate?: string;
  readonly endDate?: string;
}): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  _tableId: input.tableId,
  startDate: input.startDate ?? testStart,
  endDate: input.endDate ?? testEnd,
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

const runWithInventory = <A>(
  effect: Effect.Effect<A, unknown, WorkspaceAvailabilityService>,
  input: {
    readonly tables?: readonly Table[];
    readonly reservations?: readonly Reservation[];
  } = {}
) =>
  effect.pipe(
    Effect.provide(WorkspaceAvailabilityServiceLive),
    Effect.provide(
      Layer.succeed(DotyposService, {
        getTables: mock(() => Effect.succeed([...(input.tables ?? defaultTables)])),
        listReservations: mock(() =>
          Effect.succeed([...(input.reservations ?? [])])
        ),
      })
    ),
    Effect.runPromise
  );

const getAvailability = (input: {
  readonly date?: string;
  readonly entryTier?: "basic" | "plus" | "profi";
  readonly monitorOption?: "2x27-qhd" | "2x32-qhd" | "2x27-4k" | "2x32-4k";
  readonly tables?: readonly Table[];
  readonly reservations?: readonly Reservation[];
}) =>
  runWithInventory(
    Effect.gen(function* () {
      const service = yield* WorkspaceAvailabilityService;
      return yield* service.getAvailability({
        date: input.date,
        from: testDate,
        to: testDate,
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

  test("marks a tier unavailable only when all matching tables are occupied", async () => {
    const oneBasicOccupied = await getAvailability({
      date: testDate,
      reservations: [makeReservation({ tableId: "basic-1", status: "NEW" })],
    });

    expect(oneBasicOccupied.unavailableTiers).not.toContain("basic");

    const allBasicOccupied = await getAvailability({
      date: testDate,
      reservations: [
        makeReservation({ tableId: "basic-1", status: "NEW" }),
        makeReservation({ tableId: "basic-2", status: "CONFIRMED" }),
      ],
    });

    expect(allBasicOccupied.unavailableTiers).toContain("basic");
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

    expect(availability.unavailableTiers).toContain("basic");
  });

  test("fails ensureAvailable when selected setup is occupied", async () => {
    const result = await runWithInventory(
      Effect.either(
        Effect.gen(function* () {
          const service = yield* WorkspaceAvailabilityService;
          return yield* service.ensureAvailable({
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

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(WorkspaceTableUnavailableError);
    }
  });
});
