import {
  type DotyposCustomerId,
  type DotyposReadFailure,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Array as Arr, Context, Effect, Layer } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import type { SharedSnapshotLoadFailure } from "@/shared/backend/shared-snapshot";
import {
  type ReservationRecord,
  toReservationRecord,
} from "./reservation-record";

export type ReservationRecordsError =
  | DotyposReadFailure
  | SharedSnapshotLoadFailure;

/** The reservation details customers and their agents read. */
export interface ReservationRecordReads {
  readonly get: (
    id: DotyposReservationId
  ) => Effect.Effect<ReservationRecord, ReservationRecordsError>;
  /**
   * The customer's reservations, newest start first. `recordedIds` are the
   * customer's reservations Workspace recorded, which a list snapshot taken
   * before one of them was booked doesn't hold yet.
   */
  readonly listForCustomer: (input: {
    readonly customerId: DotyposCustomerId;
    readonly recordedIds: readonly DotyposReservationId[];
  }) => Effect.Effect<readonly ReservationRecord[], ReservationRecordsError>;
  readonly listByIds: (
    ids: readonly DotyposReservationId[]
  ) => Effect.Effect<readonly ReservationRecord[], ReservationRecordsError>;
}

/**
 * Groups sorted IDs into stable snapshot keys, independent of provider transport batching.
 */
export const readReservationSnapshotGroups = <E>(
  ids: readonly DotyposReservationId[],
  readBatch: (
    batch: readonly DotyposReservationId[]
  ) => Effect.Effect<readonly ReservationRecord[], E>
) =>
  Effect.forEach(Arr.chunksOf([...new Set(ids)].toSorted(), 50), readBatch, {
    concurrency: "inherit",
  }).pipe(Effect.map((batches) => batches.flat()));

/** Reads every reservation record live from Dotypos. */
const makeProviderReservationRecords = Effect.gen(function* () {
  const dotypos = yield* DotyposService;

  return {
    get: (id) =>
      dotypos
        .getReservationWithoutCustomer(id)
        .pipe(Effect.map(toReservationRecord)),
    // The live list already holds every recorded reservation.
    listForCustomer: ({ customerId }) =>
      dotypos
        .listReservations({ customerId, order: "startDateDescending" })
        .pipe(
          Effect.map((reservations) => reservations.map(toReservationRecord))
        ),
    listByIds: (ids) =>
      dotypos
        .getReservationsByIds(ids.toSorted(), {
          order: "startDateDescending",
        })
        .pipe(
          Effect.map((reservations) =>
            [...reservations.values()].map(toReservationRecord)
          )
        ),
  } satisfies ReservationRecordReads;
});

/**
 * Reservation details for customer-facing reads. Browser pages read them
 * live (`Live`) so staff edits show on the next load; customers' AI agents
 * read the shared snapshots in `SharedReservationRecordsLive`. Statuses come
 * from Workspace rows; checks that guard a booking read Dotypos directly.
 */
export class ReservationRecords extends Context.Service<
  ReservationRecords,
  ReservationRecordReads
>()("@deskohub-workspace/reservation/ReservationRecords") {
  static Provider = Layer.effect(this, makeProviderReservationRecords);

  static Live = this.Provider.pipe(Layer.provide(WorkspaceDotyposLayer));
}
