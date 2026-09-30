import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";
import {
  WorkspaceReservationDetailsError,
  WorkspaceReservationService,
} from "./workspace-reservation.service";

const customer: Customer = {
  _cloudId: "cloud",
  email: "customer@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
};

type TestWorkspaceReservation = Pick<
  WorkspaceReservation,
  | "id"
  | "dotyposCustomerId"
  | "dotyposReservationId"
  | "reservationDetails"
  | "reservationState"
  | "paymentState"
  | "locale"
>;

const makeWorkspaceReservation = (
  overrides: Partial<TestWorkspaceReservation> = {}
): TestWorkspaceReservation => ({
  id: "reservation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: " dotypos-reservation-id ",
  reservationState: "confirmed",
  paymentState: "paid",
  reservationDetails: {
    kind: "cowork",
    entryTier: "profi",
    coffee: true,
    monitorOption: "2x27-qhd",
  },
  locale: "cs-CZ",
  ...overrides,
});

const makeDotyposReservation = (
  overrides: Partial<Reservation> = {}
): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  _customerId: "customer-id",
  _tableId: " table-id ",
  startDate: "2026-06-15T22:00:00.000Z",
  endDate: "2026-06-16T22:00:00.000Z",
  seats: "1",
  status: "CONFIRMED",
  ...overrides,
});

const makeTable = (overrides: Partial<Table> = {}): Table => ({
  _cloudId: "cloud",
  id: "table-id",
  name: " 12 ",
  display: true,
  enabled: true,
  locationName: "Main room",
  seats: "1",
  tags: ["tier:profi"],
  ...overrides,
});

const detailsEffect = (input: {
  readonly seatingMapEnabled?: boolean;
  readonly workspaceReservation?: TestWorkspaceReservation | null;
  readonly dotyposReservation?: Reservation;
  readonly tables?: readonly Table[];
  readonly onProviderRead?: (provider: "getReservation" | "getTables") => void;
}) => {
  const repository = {
    findById: mock(() =>
      Effect.succeed(
        (input.workspaceReservation === undefined
          ? makeWorkspaceReservation()
          : input.workspaceReservation) as WorkspaceReservation | null
      )
    ),
  };
  const dotypos = {
    getReservation: mock(() => {
      input.onProviderRead?.("getReservation");
      return Effect.succeed({
        reservation: input.dotyposReservation ?? makeDotyposReservation(),
        customer,
      });
    }),
    getTables: mock(() => {
      input.onProviderRead?.("getTables");
      return Effect.succeed(input.tables ?? [makeTable()]);
    }),
  };

  return Effect.gen(function* () {
    const service = yield* WorkspaceReservationService;
    return yield* service.getReservation("reservation-id");
  }).pipe(
    Effect.provide(
      WorkspaceReservationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkspaceReservationRepository, repository),
            Layer.mock(DotyposService, dotypos),
            SeatingMapFeatureFlagServiceMock({
              isEnabled: Effect.succeed(input.seatingMapEnabled ?? true),
            })
          )
        )
      )
    )
  );
};

const accessTargetEffect = (input: {
  readonly workspaceReservation?: TestWorkspaceReservation;
  readonly dotyposReservation?: Reservation;
}) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceReservationService;
    return yield* service.getAccessTarget("reservation-id");
  }).pipe(
    Effect.provide(
      WorkspaceReservationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkspaceReservationRepository, {
              findById: mock(() =>
                Effect.succeed(
                  (input.workspaceReservation ??
                    makeWorkspaceReservation()) as WorkspaceReservation
                )
              ),
            }),
            Layer.mock(DotyposService, {
              getReservation: mock(() =>
                Effect.succeed({
                  reservation:
                    input.dotyposReservation ?? makeDotyposReservation(),
                  customer,
                })
              ),
              getTables: mock(() => Effect.succeed([])),
            }),
            SeatingMapFeatureFlagServiceMock({
              isEnabled: Effect.succeed(false),
            })
          )
        )
      )
    )
  );

describe("WorkspaceReservationService", () => {
  test("builds details from Dotypos reservation dates and table", async () => {
    const details = await Effect.runPromise(
      detailsEffect({
        tables: [
          makeTable(),
          makeTable({ id: "neighbor-table", name: "11" }),
          makeTable({
            id: "quiet-table",
            name: "1",
            locationName: "Quiet room",
          }),
        ],
      })
    );

    expect(details).toMatchObject({
      id: "reservation-id",
      dotyposCustomerId: "customer-id",
      dotyposReservationId: "dotypos-reservation-id",
      reservationDetails: {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      customer,
      tableName: "12",
      tableMap: {
        assignedTableId: "table-id",
        roomName: "Main room",
      },
    });
    expect(details.tableMap?.tables.map((table) => table.id)).toEqual([
      "table-id",
      "neighbor-table",
    ]);
    expect(
      details.reservedFrom.equals(
        Temporal.Instant.from("2026-06-15T22:00:00.000Z")
      )
    ).toBe(true);
    expect(
      details.reservedUntil.equals(
        Temporal.Instant.from("2026-06-16T22:00:00.000Z")
      )
    ).toBe(true);
  });

  test("lists named, assignable Open Space tables with valid capacity", async () => {
    const providerReads: Array<"getReservation" | "getTables"> = [];
    const details = await Effect.runPromise(
      detailsEffect({
        workspaceReservation: makeWorkspaceReservation({
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
        }),
        tables: [
          makeTable({
            id: "table-id",
            name: "  Assigned desk  ",
            seats: "2",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "free-table",
            name: " Free desk ",
            seats: "4",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "occupied-table",
            name: " Occupied desk ",
            seats: "3",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "disabled-table",
            name: "Disabled desk",
            enabled: false,
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "undisplayed-table",
            name: "Undisplayed desk",
            display: false,
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "   ",
            name: "Unassignable desk",
            tags: ["cowork:open-space"],
          }),
          makeTable({ id: "historical-table", name: "Historical desk" }),
          makeTable({
            id: "monitor-table",
            name: "Monitor desk",
            tags: ["cowork:open-space", "monitor:size:27"],
          }),
          makeTable({
            id: "missing-capacity",
            name: "Missing capacity desk",
            seats: undefined,
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "zero-capacity",
            name: "Zero capacity desk",
            seats: "0",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "negative-capacity",
            name: "Negative capacity desk",
            seats: "-1",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "fractional-capacity",
            name: "Fractional capacity desk",
            seats: "1.5",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "invalid-capacity",
            name: "Invalid capacity desk",
            seats: "not-a-number",
            tags: ["cowork:open-space"],
          }),
          makeTable({
            id: "unnamed-table",
            name: "   ",
            tags: ["cowork:open-space"],
          }),
        ],
        onProviderRead: (provider) => providerReads.push(provider),
      })
    );

    expect(details.openSpaceTableNames).toEqual([
      "Assigned desk",
      "Free desk",
      "Occupied desk",
    ]);
    expect(details.tableName).toBe("Assigned desk");
    expect(providerReads.sort()).toEqual(["getReservation", "getTables"]);
  });

  test("does not fall back to the assigned table name when no eligible name exists", async () => {
    const details = await Effect.runPromise(
      detailsEffect({
        workspaceReservation: makeWorkspaceReservation({
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
        }),
        tables: [
          makeTable({
            id: "table-id",
            name: "   ",
            tags: ["cowork:open-space"],
          }),
        ],
      })
    );

    expect(details.openSpaceTableNames).toEqual([]);
    expect(details.tableName).toBe("table-id");
  });

  test("keeps Open Space table names out of other tiers and reservation families", async () => {
    const otherReservationDetails = [
      {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
      },
      {
        kind: "cowork",
        entryTier: "plus",
        coffee: true,
      },
      {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      { kind: "meeting-room" },
      { kind: "office" },
    ] satisfies readonly TestWorkspaceReservation["reservationDetails"][];

    for (const reservationDetails of otherReservationDetails) {
      const details = await Effect.runPromise(
        detailsEffect({
          workspaceReservation: makeWorkspaceReservation({
            reservationDetails,
          }),
        })
      );

      expect(details).not.toHaveProperty("openSpaceTableNames");
      expect(details.tableName).toBe("12");
    }
  });

  test("fails when Dotypos reservation date is invalid", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        detailsEffect({
          dotyposReservation: makeDotyposReservation({ startDate: "nope" }),
        })
      )
    );

    expect(error).toBeInstanceOf(WorkspaceReservationDetailsError);
    expect(error).toMatchObject({
      reservationId: "reservation-id",
      errorCode: "dotypos_reservation_date_invalid",
    });
  });

  test("keeps the table number but omits the seating map while disabled", async () => {
    const details = await Effect.runPromise(
      detailsEffect({ seatingMapEnabled: false })
    );

    expect(details.tableName).toBe("12");
    expect(details.tableMap).toBeUndefined();
  });

  test("rejects a Dotypos reservation whose end precedes its start", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        detailsEffect({
          dotyposReservation: makeDotyposReservation({
            startDate: "2026-06-16T06:00:00Z",
            endDate: "2026-06-15T06:00:00Z",
          }),
        })
      )
    );

    expect(error).toBeInstanceOf(WorkspaceReservationDetailsError);
    expect(error).toMatchObject({
      reservationId: "reservation-id",
      errorCode: "dotypos_reservation_date_invalid",
    });
  });

  test("rejects access recovery unless both local and provider reservations are eligible", async () => {
    for (const effect of [
      accessTargetEffect({
        workspaceReservation: makeWorkspaceReservation({
          paymentState: "not_started",
        }),
      }),
      accessTargetEffect({
        dotyposReservation: makeDotyposReservation({ status: "CANCELLED" }),
      }),
    ]) {
      const error = await Effect.runPromise(Effect.flip(effect));
      expect(error).toMatchObject({
        reservationId: "reservation-id",
        errorCode: "reservation_access_unavailable",
      });
    }
  });
});
