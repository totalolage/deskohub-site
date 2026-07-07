import { DotyposRuntimeConfig, DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { DatasourceConfig } from "../config";
import { assert, log } from "../runtime";
import type { CheckoutData, CheckoutRow } from "../types";

export const validateDotypos = async (
  config: DatasourceConfig,
  data: CheckoutData,
  row: CheckoutRow
) => {
  assert(
    row.dotypos_reservation_id,
    "Dotypos reservation id missing before validation"
  );
  assert(
    row.dotypos_customer_id,
    "Dotypos customer id missing before validation"
  );
  const dotyposReservationId = row.dotypos_reservation_id;

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      return yield* dotypos.getReservation(dotyposReservationId);
    }).pipe(Effect.provide(getDotyposLayer(config)))
  );

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
  log("Dotypos reservation state validated");
};

export const cancelDotyposReservation = async (
  config: DatasourceConfig,
  dotyposReservationId: string
) => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      yield* dotypos.cancelReservation(dotyposReservationId);
    }).pipe(Effect.provide(getDotyposLayer(config)))
  );
  log("Dotypos reservation cancelled after validation");
};

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
