import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { cacheLife, cacheTag } from "next/cache";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  cachedOnSuccess,
  fromSharedSnapshot,
} from "@/shared/backend/shared-snapshot";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { reservationRecordTags } from "@/shared/utils/cache-tags";
import type { ReservationRecord } from "./reservation-record";
import {
  type ReservationRecordReads,
  ReservationRecords,
  type ReservationRecordsError,
  readRecordsInSortedBatches,
} from "./reservation-records";

/**
 * Serves customer-facing reservation details from cross-request snapshots,
 * fresh for the `reservationRecords` profile's `revalidate` window and served
 * stale while they refresh until `expire`. Every Dotypos reservation write
 * expires them. Callers authorize the reservation or account before reading;
 * the snapshots hold no customer links or notes. Failed loads are never
 * cached.
 *
 * The loaders are only referenced inside callbacks: the `"use cache"` compiler
 * turns them into bindings assigned after this layer is evaluated.
 */
export const SharedReservationRecordsLive = Layer.succeed(ReservationRecords, {
  get: (id) =>
    fromRecordsSnapshot("get", () => loadSharedReservationRecord(id)),
  listForCustomer: (customerId) =>
    fromRecordsSnapshot("listForCustomer", () =>
      loadSharedCustomerReservationRecords(customerId)
    ),
  listByIds: (ids) =>
    readRecordsInSortedBatches(ids, (batch) =>
      fromRecordsSnapshot("listByIds", () =>
        loadSharedReservationRecordsByIds(batch)
      )
    ),
} satisfies ReservationRecordReads);

export async function loadSharedReservationRecord(
  id: DotyposReservationId
): Promise<ReservationRecord> {
  "use cache: remote";

  return await readThroughProvider(
    "reservation.records.reservation.load",
    (records) => records.get(id)
  );
}

export async function loadSharedCustomerReservationRecords(
  customerId: DotyposCustomerId
): Promise<readonly ReservationRecord[]> {
  "use cache: remote";

  return await readThroughProvider(
    "reservation.records.customer.load",
    (records) => records.listForCustomer(customerId)
  );
}

/** Keyed by one sorted id batch, so equal id sets share an entry. */
async function loadSharedReservationRecordsByIds(
  ids: readonly DotyposReservationId[]
): Promise<readonly ReservationRecord[]> {
  "use cache: remote";

  return await readThroughProvider("reservation.records.ids.load", (records) =>
    records.listByIds(ids)
  );
}

const readThroughProvider = <A>(
  operation: string,
  read: (
    records: ReservationRecordReads
  ) => Effect.Effect<A, ReservationRecordsError>
) =>
  Effect.flatMap(ReservationRecords, read).pipe(
    Effect.provide(
      ReservationRecords.Provider.pipe(Layer.provide(WorkspaceDotyposLayer))
    ),
    cachedOnSuccess(() => {
      cacheLife("reservationRecords");
      cacheTag(reservationRecordTags.records);
    }),
    runWorkspaceEffect(operation)
  );

function fromRecordsSnapshot<A>(operation: string, load: () => Promise<A>) {
  return fromSharedSnapshot({
    service: "reservation-records",
    operation,
    load,
  });
}
