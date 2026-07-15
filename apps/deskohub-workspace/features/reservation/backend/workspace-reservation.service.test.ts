import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Customer, Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema/workspace-reservations";
import {
  WorkspaceReservationRepository,
  type WorkspaceReservationRepository as WorkspaceReservationRepositoryType,
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
  | "customerAccessCode"
  | "productTier"
  | "productCoffee"
  | "productMonitorOption"
  | "locale"
>;

const makeWorkspaceReservation = (
  overrides: Partial<TestWorkspaceReservation> = {}
): TestWorkspaceReservation => ({
  id: "reservation-id",
  dotyposCustomerId: "customer-id",
  dotyposReservationId: " dotypos-reservation-id ",
  customerAccessCode: "1234",
  productTier: "profi",
  productCoffee: true,
  productMonitorOption: "2x27-qhd",
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
  readonly workspaceReservation?: TestWorkspaceReservation | null;
  readonly dotyposReservation?: Reservation;
  readonly tables?: readonly Table[];
}) => {
  const repository = {
    findById: mock(() =>
      Effect.succeed(
        (input.workspaceReservation === undefined
          ? makeWorkspaceReservation()
          : input.workspaceReservation) as WorkspaceReservation | null
      )
    ),
  } as unknown as WorkspaceReservationRepositoryType;
  const dotypos = {
    getReservation: mock(() =>
      Effect.succeed({
        reservation: input.dotyposReservation ?? makeDotyposReservation(),
        customer,
      })
    ),
    getTables: mock(() => Effect.succeed(input.tables ?? [makeTable()])),
  } as unknown as typeof DotyposService.Service;

  return Effect.gen(function* () {
    const service = yield* WorkspaceReservationService;
    return yield* service.getReservation("reservation-id");
  }).pipe(
    Effect.provide(WorkspaceReservationService.Live),
    Effect.provide(Layer.succeed(WorkspaceReservationRepository, repository)),
    Effect.provide(Layer.succeed(DotyposService, dotypos))
  );
};

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
    expect(details.reservedFrom.toISOString()).toBe("2026-06-15T22:00:00.000Z");
    expect(details.reservedUntil.toISOString()).toBe(
      "2026-06-16T22:00:00.000Z"
    );
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

  test("accepts Dotypos millisecond timestamp strings", async () => {
    const details = await Effect.runPromise(
      detailsEffect({
        dotyposReservation: makeDotyposReservation({
          startDate: String(Date.UTC(2026, 5, 15, 6)),
          endDate: String(Date.UTC(2026, 5, 16, 6)),
        }),
      })
    );

    expect(details.reservedFrom.toISOString()).toBe("2026-06-15T06:00:00.000Z");
    expect(details.reservedUntil.toISOString()).toBe(
      "2026-06-16T06:00:00.000Z"
    );
  });
});
