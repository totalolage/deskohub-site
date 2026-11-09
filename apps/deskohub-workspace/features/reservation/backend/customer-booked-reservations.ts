import {
  type DotyposCustomerId,
  type DotyposReadFailure,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type ReadLimitExceededError,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { decodeBookedReservation } from "./booked-reservation";

/**
 * What a customer may read about one reservation Dotypos holds for them: its
 * status, the span Dotypos holds, and its seats. An early-setup meeting room
 * is held from its setup start; its Workspace record's product says so. A
 * start, end, or seat count Workspace can't read is null. No table, note, or
 * customer link is returned.
 */
export type CustomerBookedReservation = {
  readonly dotyposReservationId: DotyposReservationId;
  readonly status: DotyposReservation["status"];
  readonly startsAt: Temporal.Instant | null;
  readonly endsAt: Temporal.Instant | null;
  readonly seats: number | null;
};

const toCustomerBookedReservation = (
  reservation: DotyposReservation
): CustomerBookedReservation => {
  const booked = decodeBookedReservation(reservation);
  return {
    dotyposReservationId: reservation.id,
    status: reservation.status,
    startsAt: Option.getOrNull(booked.start),
    endsAt: Option.getOrNull(booked.end),
    seats: Option.getOrNull(booked.seats),
  };
};

export interface CustomerBookedReservationReads {
  /**
   * The reservations Dotypos holds for exactly one customer, newest start
   * first, read live. Dotypos filters by the reservation's customer, so a
   * reservation the customer's account booked for another customer is never
   * read. Pages are read one at a time and reading stops once more than
   * `limit` reservations arrived, so at most `limit` plus one page is held;
   * it then fails with `ReadLimitExceededError`, returning nothing. Each page
   * is one Dotypos request that isn't retried, so a failed page fails the read.
   */
  readonly listForCustomer: (input: {
    readonly customerId: DotyposCustomerId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerBookedReservation[],
    DotyposReadFailure | ReadLimitExceededError
  >;
}

const makeCustomerBookedReservations = Effect.gen(function* () {
  const dotypos = yield* DotyposService;

  const listForCustomer = Effect.fn(
    "CustomerBookedReservations.listForCustomer"
  )(
    function* (input: {
      readonly customerId: DotyposCustomerId;
      readonly limit: number;
    }) {
      const reservations = new Map<DotyposReservationId, DotyposReservation>();
      let page = Option.some(1);
      while (Option.isSome(page) && reservations.size <= input.limit) {
        const result = yield* dotypos.listReservationsPage({
          customerId: input.customerId,
          order: "startDateDescending",
          page: page.value,
        });
        for (const reservation of result.reservations) {
          // A reservation that moves between pages while they're read is
          // listed once.
          if (!reservations.has(reservation.id)) {
            reservations.set(reservation.id, reservation);
          }
        }
        // An empty page ends the list, so a provider that keeps announcing
        // empty pages can't keep the read going.
        page =
          result.reservations.length === 0 ? Option.none() : result.nextPage;
      }
      const bounded = yield* requireWithinReadLimit(
        [...reservations.values()],
        input.limit
      );
      return bounded.map(toCustomerBookedReservation);
    },
    (effect, { customerId, limit }) =>
      effect.pipe(Effect.annotateLogs({ dotyposCustomerId: customerId, limit }))
  );

  return { listForCustomer } satisfies CustomerBookedReservationReads;
});

/**
 * One customer's reservations as Dotypos holds them, for reads that must
 * cover every reservation of that customer within a caller's bound, such as
 * the customer's data export. Pages and agents use `ReservationRecords`.
 */
export class CustomerBookedReservations extends Context.Service<
  CustomerBookedReservations,
  CustomerBookedReservationReads
>()("@deskohub-workspace/reservation/CustomerBookedReservations") {
  static Provider = Layer.effect(this, makeCustomerBookedReservations);

  static Live = this.Provider.pipe(Layer.provide(WorkspaceDotyposLayer));
}
