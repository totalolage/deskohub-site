import {
  type DotyposCustomerId,
  type DotyposReservationId,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  readInIdFilterBatches,
  type ValidationError,
} from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type ReservationRecord,
  toReservationRecord,
} from "./reservation-record";

export type ReservationRecordsError =
  | ExternalAPIError
  | NetworkError
  | ValidationError;

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
 * Reads ids in sorted `id|in|` batches, so the same ids always form the same
 * batches whatever order the caller lists them in.
 */
export const readRecordsInSortedBatches = <E>(
  ids: readonly DotyposReservationId[],
  readBatch: (
    batch: readonly DotyposReservationId[]
  ) => Effect.Effect<readonly ReservationRecord[], E>
) =>
  readInIdFilterBatches(ids.toSorted(), readBatch).pipe(
    Effect.map((batches) => batches.flat())
  );

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
      readRecordsInSortedBatches(ids, (batch) =>
        dotypos
          .listReservations({ ids: batch, order: "startDateDescending" })
          .pipe(
            Effect.map((reservations) => reservations.map(toReservationRecord))
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
