import { seededReservationReads } from "@deskohub/dotypos/backend/service.mock";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  type DotyposReadFailure,
  DotyposRejected,
  type DotyposReservationId,
  DotyposReservationIdSchema,
  DotyposService,
  type ReservationListOptions,
} from "@deskohub/dotypos";
import type { Reservation as DotyposReservation } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { reservationRecordTags } from "@/shared/utils/cache-tags";
import { ReservationRecords } from "./reservation-records";

let providerFailure: DotyposReadFailure | undefined;

const reservationId = DotyposReservationIdSchema.make("synthetic-reservation");
const customerId = DotyposCustomerIdSchema.make("synthetic-customer");
const reservation: DotyposReservation = {
  _branchId: "synthetic-branch",
  _cloudId: "synthetic-cloud",
  _customerId: customerId,
  _tableId: "synthetic-table",
  endDate: "2099-06-10T15:00:00Z",
  id: reservationId,
  note: "Synthetic customer note",
  seats: "1",
  startDate: "2099-06-10T07:00:00Z",
  status: "NEW",
};
const record = {
  id: reservationId,
  status: "NEW",
  _tableId: "synthetic-table",
  startDate: "2099-06-10T07:00:00Z",
  endDate: "2099-06-10T15:00:00Z",
  seats: "1",
};

const getReservationWithoutCustomer = mock((_id: DotyposReservationId) =>
  providerFailure ? Effect.fail(providerFailure) : Effect.succeed(reservation)
);
const listReservations = mock((_options: ReservationListOptions) =>
  Effect.succeed([reservation])
);
const nextCache = recordNextCache();

mock.module("next/cache", () => nextCache.module);
mock.module("@/shared/backend/config/dotypos.config", () => ({
  WorkspaceDotyposLayer: Layer.succeed(DotyposService, {
    getReservationWithoutCustomer,
    listReservations,
    getReservationsByIds: (ids, options) =>
      listReservations({ ...options, ids: [...ids] }).pipe(
        Effect.flatMap((records) =>
          seededReservationReads(records).getReservationsByIds(ids)
        )
      ),
  } as never),
}));

const {
  loadSharedCustomerReservationRecords,
  loadSharedReservationRecord,
  SharedReservationRecordsLive,
} = await import("./reservation-records-cache.server");

beforeEach(() => {
  providerFailure = undefined;
  for (const fn of [getReservationWithoutCustomer, listReservations]) {
    fn.mockClear();
  }
  nextCache.clear();
  listReservations.mockImplementation(() => Effect.succeed([reservation]));
});

const expectRecordsLifetime = (loads: number) => {
  expect(nextCache.calls).toEqual(
    Array.from({ length: loads }, () => [
      { cacheLife: "reservationRecords" },
      { cacheTag: [reservationRecordTags.records] },
    ]).flat()
  );
};

describe("shared reservation records", () => {
  test("share one reservation without its customer link or note", async () => {
    expect(await loadSharedReservationRecord(reservationId)).toEqual(record);

    expect(getReservationWithoutCustomer).toHaveBeenCalledWith(reservationId);
    expectRecordsLifetime(1);
  });

  test("share a customer's reservations, newest start first, without customer links or notes", async () => {
    expect(await loadSharedCustomerReservationRecords(customerId)).toEqual([
      record,
    ]);

    expect(listReservations).toHaveBeenCalledWith({
      customerId,
      order: "startDateDescending",
    });
    expectRecordsLifetime(1);
  });

  test("key id reads by sorted batches, whatever order the caller lists the ids in", async () => {
    const ids = Array.from({ length: 51 }, (_, index) =>
      DotyposReservationIdSchema.make(`r-${String(index).padStart(3, "0")}`)
    );

    listReservations.mockImplementation((options) =>
      Effect.succeed([{ ...reservation, id: options.ids?.[0] }])
    );
    const records = await Effect.runPromise(
      Effect.flatMap(ReservationRecords, (shared) =>
        shared.listByIds([...ids].reverse().concat(ids[0]!))
      ).pipe(Effect.provide(SharedReservationRecordsLive))
    );

    expect(records).toEqual([
      { ...record, id: ids[0] },
      { ...record, id: ids[50] },
    ]);
    expect(listReservations.mock.calls).toEqual([
      [{ ids: ids.slice(0, 50), order: "startDateDescending" }],
      [{ ids: ids.slice(50), order: "startDateDescending" }],
    ]);
    expectRecordsLifetime(2);
  });

  // A list snapshot can predate a booking the customer made since.
  test("read the customer's recorded reservations a list snapshot lacks by ID", async () => {
    const booked = DotyposReservationIdSchema.make("synthetic-new-reservation");
    listReservations.mockImplementation((options) =>
      Effect.succeed(
        options.ids
          ? options.ids.map((id) => ({ ...reservation, id }))
          : [reservation]
      )
    );

    const records = await Effect.runPromise(
      Effect.flatMap(ReservationRecords, (shared) =>
        shared.listForCustomer({
          customerId,
          recordedIds: [reservationId, booked],
        })
      ).pipe(Effect.provide(SharedReservationRecordsLive))
    );

    expect(records).toEqual([record, { ...record, id: booked }]);
    expect(listReservations.mock.calls).toEqual([
      [{ customerId, order: "startDateDescending" }],
      [{ ids: [booked], order: "startDateDescending" }],
    ]);
    expectRecordsLifetime(2);
  });

  test("keep a failed load out of the shared cache", async () => {
    providerFailure = new DotyposRejected({
      operation: "getReservation",
      reason: "invalid-response",
      message: "Synthetic outage",
    });

    await expect(
      loadSharedReservationRecord(reservationId)
    ).rejects.toBeDefined();

    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });
});
