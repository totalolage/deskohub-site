import { DotyposRuntimeConfig, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { DatasourceConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutRow } from "../types";

export const resolveE2EDotyposDiscountGroups = (
  config: DatasourceConfig
): Effect.Effect<
  { readonly tenPercent: string; readonly twentyPercent: string },
  WorkspaceE2EError
> =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const groups = yield* dotypos.getDiscountGroups();

    const findUniqueGroup = (percent: number) =>
      tryWorkspaceE2ESync(`resolve ${percent}% Dotypos discount group`, () => {
        const matches = groups.filter(
          (group) =>
            group.id &&
            !group.deleted &&
            Number(group.discountPercent) === percent
        );
        assert(
          matches.length === 1,
          `the E2E Dotypos cloud must contain exactly one active ${percent}% discount group`
        );
        const id = matches[0]?.id;
        assert(id, `${percent}% Dotypos discount group ID missing`);
        return id;
      });

    const tenPercent = yield* findUniqueGroup(10);
    const twentyPercent = yield* findUniqueGroup(20);
    log("Dotypos customer-discount fixtures resolved");
    return { tenPercent, twentyPercent };
  }).pipe(
    Effect.provide(getDotyposLayer(config)),
    Effect.mapError((cause) =>
      toWorkspaceE2EError("resolve Dotypos discount fixtures", cause)
    )
  );

export const validateDotypos = (
  config: DatasourceConfig,
  data: CheckoutData,
  row: CheckoutRow
): Effect.Effect<void, WorkspaceE2EError> =>
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

    const result = yield* Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      return yield* dotypos.getReservation(dotyposReservationId);
    }).pipe(
      Effect.provide(getDotyposLayer(config)),
      Effect.mapError((cause) =>
        toWorkspaceE2EError("validate Dotypos reservation", cause)
      )
    );

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
      assert(
        dotyposDateCovers(
          result.reservation.startDate,
          result.reservation.endDate,
          data.date
        ),
        "Dotypos date does not cover selected checkout date"
      );
    });
    log("Dotypos reservation state validated");
  });

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
    const customer = yield* dotypos.findOrCreateCustomer(
      {
        email: data.email,
        firstName: data.name,
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
