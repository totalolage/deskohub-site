import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Option } from "effect";
import { SeatingMapReleaseGate } from "@/features/reservation/backend/seating-map-release-gate";
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
  email: testEmailAddress("customer"),
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
  id: "dotypos-reservation-id",
  _branchId: "branch",
  _cloudId: "cloud",
  _customerId: "customer-id",
  _tableId: "table-id",
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
      return Effect.succeed(
        Option.some({
          reservation: input.dotyposReservation ?? makeDotyposReservation(),
          customer,
        })
      );
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
            SeatingMapReleaseGate.fromDecision(input.seatingMapEnabled ?? true)
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
                Effect.succeed(
                  Option.some({
                    reservation:
                      input.dotyposReservation ?? makeDotyposReservation(),
                    customer,
                  })
                )
              ),
              getTables: mock(() => Effect.succeed([])),
            }),
            SeatingMapReleaseGate.fromDecision(false)
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
      placement: {
        table: { mode: "assigned", name: "12" },
        tableMap: {
          assignedTableId: "table-id",
          roomName: "Main room",
        },
      },
    });
    expect(details.placement.tableMap?.tables.map((table) => table.id)).toEqual(
      ["table-id", "neighbor-table"]
    );
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

  test("places Open Space on its shared tables, not the assigned one", async () => {
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
          makeTable({ name: "Assigned desk", tags: ["cowork:open-space"] }),
          makeTable({
            id: "free-table",
            name: "Free desk",
            tags: ["cowork:open-space"],
          }),
        ],
        onProviderRead: (provider) => providerReads.push(provider),
      })
    );

    expect(details.placement.table).toEqual({
      mode: "shared",
      name: "Assigned desk, Free desk",
    });
    expect(providerReads.sort()).toEqual(["getReservation", "getTables"]);
  });

  test("leaves the seating map out until it is released", async () => {
    const details = await Effect.runPromise(
      detailsEffect({ seatingMapEnabled: false })
    );

    expect(details.placement).toEqual({
      table: { mode: "assigned", name: "12" },
    });
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

  test("rejects a Dotypos reservation with unreadable seats", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        detailsEffect({
          dotyposReservation: makeDotyposReservation({ seats: "abc" }),
        })
      )
    );

    expect(error).toMatchObject({
      errorCode: "dotypos_reservation_seats_invalid",
    });
  });

  test("reports the booked time of an early-setup meeting room, and its door code covers the setup", async () => {
    const workspaceReservation = makeWorkspaceReservation({
      reservationDetails: { kind: "meeting-room", earlySetup: true },
    });
    // Dotypos holds the room from the setup start, 15 minutes early.
    const dotyposReservation = makeDotyposReservation({
      startDate: "2026-06-20T06:45:00.000Z",
      endDate: "2026-06-20T11:00:00.000Z",
    });

    const details = await Effect.runPromise(
      detailsEffect({
        seatingMapEnabled: false,
        workspaceReservation,
        dotyposReservation,
      })
    );
    const access = await Effect.runPromise(
      accessTargetEffect({ workspaceReservation, dotyposReservation })
    );

    expect(details.reservedFrom.toString()).toBe("2026-06-20T07:00:00Z");
    expect(details.reservedUntil.toString()).toBe("2026-06-20T11:00:00Z");
    expect(details.setupFrom?.toString()).toBe("2026-06-20T06:45:00Z");
    expect(access.reservedFrom.toString()).toBe("2026-06-20T06:45:00Z");
    expect(access.reservedUntil.toString()).toBe("2026-06-20T11:00:00Z");
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
