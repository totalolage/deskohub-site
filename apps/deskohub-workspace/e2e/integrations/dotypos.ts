import { DotyposRuntimeConfig, DotyposService } from "@deskohub/dotypos";
import type {
  Customer,
  DiscountGroup,
  Reservation,
  Table,
} from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { splitCustomerName } from "@/features/checkout/backend/reservation/dotypos-customer-policy";
import { workspaceMeetingRoomReservationTableTag } from "@/features/checkout/backend/reservation/workspace-table-selection";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import { assert, log } from "../runtime";
import { workspaceE2EPollIntervalMs } from "../timeouts";
import type { CheckoutData, CheckoutRow } from "../types";

export interface E2EDotyposDiscountGroup {
  readonly basisPoints: number;
  readonly id: string;
}

export interface ValidatedDotyposReservation {
  readonly customer: Customer;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
}

const maximumE2ECustomerDiscountBasisPoints = 9000;

export const resolveE2EDotyposDiscountGroup = (
  config: DatasourceConfig
): Effect.Effect<E2EDotyposDiscountGroup, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const groups = yield* dotypos.getDiscountGroups();
    const group = yield* tryWorkspaceE2ESync(
      "resolve Dotypos discount group",
      () => selectE2EDotyposDiscountGroup(groups)
    );
    log("Dotypos customer-discount fixtures resolved");
    return group;
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("resolve Dotypos discount fixtures", cause)
    )
  );

export const selectE2EDotyposDiscountGroup = (
  groups: readonly DiscountGroup[]
): E2EDotyposDiscountGroup => {
  const selected = groups
    .flatMap((group) => {
      const id = group.id?.trim();
      const basisPoints = toPartialDiscountBasisPoints(group.discountPercent);

      return id &&
        !group.deleted &&
        basisPoints &&
        basisPoints <= maximumE2ECustomerDiscountBasisPoints
        ? [{ basisPoints, id }]
        : [];
    })
    .toSorted(
      (left, right) =>
        left.basisPoints - right.basisPoints || left.id.localeCompare(right.id)
    )[0];

  assert(
    selected,
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
  return selected;
};

const toPartialDiscountBasisPoints = (
  discountPercent: DiscountGroup["discountPercent"]
) => {
  const normalized = discountPercent?.trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;

  const [whole = "", decimal = ""] = normalized.split(".");
  const significantDecimal = decimal.replace(/0+$/, "");
  if (significantDecimal.length > 2) return undefined;

  const wholePercentage = Number(whole);
  const fractionalBasisPoints = Number(significantDecimal.padEnd(2, "0"));
  const basisPoints = wholePercentage * 100 + fractionalBasisPoints;
  return Number.isSafeInteger(basisPoints) &&
    basisPoints >= 1 &&
    basisPoints < 10_000
    ? basisPoints
    : undefined;
};

export const validateDotypos = (
  config: DatasourceConfig,
  data: CheckoutData,
  row: CheckoutRow
): Effect.Effect<ValidatedDotyposReservation, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotyposReservationId = yield* tryWorkspaceE2ESync(
      "assert Dotypos validation row",
      () => {
        assert(
          row.dotypos_reservation_id,
          "Dotypos reservation id missing before validation"
        );
        assert(
          row.dotypos_customer_id,
          "Dotypos customer id missing before validation"
        );
        return row.dotypos_reservation_id;
      }
    );

    const result = yield* waitForConfirmedDotyposReservation(
      Effect.gen(function* () {
        const dotypos = yield* DotyposService;
        return yield* dotypos.getReservation(dotyposReservationId);
      }).pipe(
        Effect.provide(getDotyposLayer(config)),
        Effect.mapError((cause) =>
          toWorkspaceE2EError("validate Dotypos reservation", cause)
        )
      ),
      {
        intervalMs: workspaceE2EPollIntervalMs.datasource,
        timeoutMs: config.timeouts.datasource,
      }
    );
    const meetingRoomTables = data.meetingRoom
      ? yield* Effect.gen(function* () {
          const dotypos = yield* DotyposService;
          return yield* dotypos.getTables();
        }).pipe(
          Effect.provide(getDotyposLayer(config)),
          Effect.mapError((cause) =>
            toWorkspaceE2EError("validate Dotypos meeting-room table", cause)
          )
        )
      : [];

    yield* tryWorkspaceE2ESync("assert Dotypos reservation state", () => {
      assert(
        result.reservation.status === "CONFIRMED",
        "Dotypos reservation is not confirmed"
      );
      assert(
        result.reservation._customerId === row.dotypos_customer_id,
        "Dotypos customer mismatch"
      );
      assert(result.reservation._tableId, "Dotypos table id missing");
      assert(
        result.reservation.seats === "1",
        "Dotypos reservation seats should be 1"
      );
      assert(
        result.reservation.note?.includes(row.reservation_id),
        "Dotypos note missing workspace order id"
      );
      if (data.meetingRoom) {
        assert(
          dotyposTimestampMatches(
            result.reservation.startDate,
            data.meetingRoom.startsAt
          ),
          "Dotypos meeting-room start does not match the selected time"
        );
        assert(
          dotyposTimestampMatches(
            result.reservation.endDate,
            data.meetingRoom.endsAt
          ),
          "Dotypos meeting-room end does not match the selected time"
        );
        const assignedTable = meetingRoomTables.find(
          (table) => table.id === result.reservation._tableId
        );
        assert(
          assignedTable?.enabled === true && assignedTable.display === true,
          "Dotypos meeting-room table is not active and visible"
        );
        assert(
          assignedTable.tags?.includes(workspaceMeetingRoomReservationTableTag),
          "Dotypos reservation is not assigned to a meeting-room table"
        );
      } else {
        assert(
          dotyposDateCovers(
            result.reservation.startDate,
            result.reservation.endDate,
            data.date
          ),
          "Dotypos date does not cover selected checkout date"
        );
      }
    });
    log("Dotypos reservation state validated");

    return yield* tryWorkspaceE2ESync(
      "read validated Dotypos reservation details",
      () => ({
        customer: result.customer,
        reservedFrom: parseDotyposInstant(result.reservation.startDate),
        reservedUntil: parseDotyposInstant(result.reservation.endDate),
      })
    );
  });

export const waitForConfirmedDotyposReservation = <
  A extends {
    readonly reservation: {
      readonly status?: string | null;
    };
  },
  E,
  R,
>(
  readReservation: Effect.Effect<A, E, R>,
  options: {
    readonly intervalMs: number;
    readonly timeoutMs: number;
  }
): Effect.Effect<A, E | WorkspaceE2EError, R> =>
  pollUntil(
    readReservation.pipe(
      Effect.map((result) =>
        result.reservation.status === "CONFIRMED" ? result : undefined
      )
    ),
    {
      intervalMs: options.intervalMs,
      label: "confirmed Dotypos reservation",
      timeoutMs: options.timeoutMs,
    }
  );

export const cancelDotyposReservation = (
  config: DatasourceConfig,
  dotyposReservationId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    yield* dotypos.cancelReservation(dotyposReservationId);
    log("Dotypos reservation cancelled after validation");
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("cancel Dotypos reservation", cause)
    )
  );

export const readDotyposReservationStatus = (
  config: DatasourceConfig,
  dotyposReservationId: string
) =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getReservationStatus(dotyposReservationId);
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("read Dotypos reservation status", cause)
    )
  );

export const prepareDotyposCustomerDiscount = (
  config: DatasourceConfig,
  data: CheckoutData,
  discountGroupId: string
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const customerName = splitCustomerName(data.name);
    const customer = yield* dotypos.findOrCreateCustomer(
      {
        ...customerName,
        email: data.email,
        phone: data.phone,
      },
      { lookupFields: ["email"] }
    );
    const customerId = yield* tryWorkspaceE2ESync(
      "assert prepared Dotypos customer",
      () => {
        assert(customer.id, "prepared Dotypos customer ID missing");
        return customer.id;
      }
    );
    yield* dotypos.setCustomerDiscountGroup(customerId, discountGroupId);
    log("Dotypos customer discount fixture prepared");
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("prepare Dotypos customer discount", cause)
    )
  );

export const changeDotyposCustomerDiscount = (
  config: DatasourceConfig,
  customerId: string,
  discountGroupId: string | null
): Effect.Effect<void, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    yield* dotypos.setCustomerDiscountGroup(customerId, discountGroupId);
    log("Dotypos customer discount fixture changed");
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("change Dotypos customer discount", cause)
    )
  );

export const loadDotyposCapacityInventory = (
  config: DatasourceConfig
): Effect.Effect<
  {
    readonly reservations: readonly Reservation[];
    readonly tables: readonly Table[];
  },
  WorkspaceE2EError
> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* Effect.all(
      {
        reservations: dotypos.listReservations(),
        tables: dotypos.getTables(),
      },
      { concurrency: "unbounded" }
    );
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("load aggregate Dotypos capacity inventory", cause)
    )
  );

const getDotyposLayer = (config: DatasourceConfig) =>
  DotyposService.Default.pipe(
    Layer.provide(
      Layer.succeed(DotyposRuntimeConfig, {
        apiTimeout: config.dotypos.apiTimeout,
        apiUrl: config.dotypos.apiUrl,
        branchId: config.dotypos.branchId,
        clientId: config.dotypos.clientId,
        clientSecret: config.dotypos.clientSecret,
        cloudId: config.dotypos.cloudId,
        employeeId: config.dotypos.employeeId,
        refreshToken: config.dotypos.refreshToken,
        reservationTableIds: [],
      })
    )
  );

const dotyposDateCovers = (
  start: string,
  end: string,
  expectedDate: string
) => {
  const selected = new Date(`${expectedDate}T12:00:00.000Z`).getTime();
  return (
    parseDotyposTimestamp(start) <= selected &&
    selected <= parseDotyposTimestamp(end)
  );
};

const parseDotyposTimestamp = (value: string) =>
  /^\d+$/.test(value) ? Number(value) : new Date(value).getTime();

const parseDotyposInstant = (value: string) => {
  const epochMilliseconds = parseDotyposTimestamp(value);
  assert(Number.isSafeInteger(epochMilliseconds), "invalid Dotypos timestamp");
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
};

export const dotyposTimestampMatches = (actual: string, expected: string) =>
  parseDotyposTimestamp(actual) === new Date(expected).getTime();
