import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  fromSharedSnapshot,
  readSharedSnapshot,
} from "@/shared/backend/shared-snapshot";
import { reservationRecordTags } from "@/shared/utils/cache-tags";
import type { ReservationRecord } from "./reservation-record";
import {
  type ReservationRecordReads,
  ReservationRecords,
  type ReservationRecordsError,
  readReservationSnapshotGroups,
} from "./reservation-records";

/**
 * Serves the reservation details customers' AI agents read from
 * cross-request snapshots, so agent reads don't spend the shared Dotypos
 * quota; browser pages read live. Snapshots are fresh for the `reservationRecords` profile's `revalidate` window and served
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
  // A list snapshot can predate a booking the customer made since, so the
  // recorded reservations it lacks are read by ID.
  listForCustomer: ({ customerId, recordedIds }) =>
    fromRecordsSnapshot("listForCustomer", () =>
      loadSharedCustomerReservationRecords(customerId)
    ).pipe(
      Effect.flatMap((listed) => {
        const listedIds = new Set(
          listed.flatMap((reservation) => reservation.id ?? [])
        );
        return listSharedByIds(
          recordedIds.filter((id) => !listedIds.has(id))
        ).pipe(Effect.map((unlisted) => [...listed, ...unlisted]));
      })
    ),
  listByIds: (ids) => listSharedByIds(ids),
} satisfies ReservationRecordReads);

function listSharedByIds(ids: readonly DotyposReservationId[]) {
  return readReservationSnapshotGroups(ids, (batch) =>
    fromRecordsSnapshot("listByIds", () =>
      loadSharedReservationRecordsByIds(batch)
    )
  );
}

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
    (records) => records.listForCustomer({ customerId, recordedIds: [] })
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
  readSharedSnapshot(
    operation,
    Effect.flatMap(ReservationRecords, read).pipe(
      Effect.provide(
        ReservationRecords.Provider.pipe(Layer.provide(WorkspaceDotyposLayer))
      )
    ),
    {
      complete: {
        lifetime: "reservationRecords",
        tags: [reservationRecordTags.records],
      },
    }
  );

function fromRecordsSnapshot<A>(operation: string, load: () => Promise<A>) {
  return fromSharedSnapshot({
    service: "reservation-records",
    operation,
    load,
  });
}
