import {
  type DotyposCustomerId,
  type DotyposReadFailure,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Option } from "effect";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type ReadLimitExceededError,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";
import { decodeBookedReservation } from "./booked-reservation";

/**
 * Dotypos answered with something the customer's reservations can't be read
 * from: a reservation whose held span (both bounds, the end after the start)
 * or seats Workspace can't read, or pages
 * that contradict each other (an empty page announcing another, or a
 * reservation listed twice because the list moved while it was paged).
 */
export class CustomerBookedReservationsUnreadableError extends Data.TaggedError(
  "CustomerBookedReservationsUnreadableError"
)<{
  readonly reason: "malformed-reservation" | "inconsistent-pages";
  readonly dotyposReservationId?: DotyposReservationId;
}> {}

/**
 * What a customer may read about one reservation Dotypos holds for them: its
 * status, seats, and the span Dotypos holds it for. An early-setup meeting
 * room is held from its setup start, before its booked start; the customer's
 * Workspace reservation record with this `dotyposReservationId` holds the
 * product, early setup included. No table, note, or customer link is returned.
 */
export type CustomerBookedReservation = {
  readonly dotyposReservationId: DotyposReservationId;
  readonly status: DotyposReservation["status"];
  readonly heldFrom: Temporal.Instant;
  readonly heldUntil: Temporal.Instant;
  readonly seats: number;
};

const toCustomerBookedReservation = (reservation: DotyposReservation) => {
  const booked = decodeBookedReservation(reservation);
  // Without stored details the occupied interval is the span Dotypos holds;
  // it is none unless both bounds decode and the end follows the start.
  return Option.all({
    held: booked.occupiedInterval,
    seats: booked.seats,
  }).pipe(
    Option.match({
      onNone: () =>
        Effect.fail(
          new CustomerBookedReservationsUnreadableError({
            reason: "malformed-reservation",
            dotyposReservationId: reservation.id,
          })
        ),
      onSome: ({ held, seats }) =>
        Effect.succeed<CustomerBookedReservation>({
          dotyposReservationId: reservation.id,
          status: reservation.status,
          heldFrom: held.startsAt,
          heldUntil: held.endsAt,
          seats,
        }),
    })
  );
};

const inconsistentPages = () =>
  new CustomerBookedReservationsUnreadableError({
    reason: "inconsistent-pages",
  });

export interface CustomerBookedReservationReads {
  /**
   * The reservations Dotypos holds for exactly one customer, newest start
   * first, read live. Dotypos filters by the reservation's customer, so a
   * reservation the customer's account booked for another customer is never
   * read. Pages are read one at a time and reading stops once more than
   * `limit` reservations arrived, so at most `limit` plus one page is held;
   * it then fails with `ReadLimitExceededError`, returning nothing. Each page
   * is one Dotypos request that isn't retried, so a failed page fails the
   * read. Fails with `CustomerBookedReservationsUnreadableError` rather than
   * return a list it can't vouch for.
   */
  readonly listForCustomer: (input: {
    readonly customerId: DotyposCustomerId;
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerBookedReservation[],
    | DotyposReadFailure
    | ReadLimitExceededError
    | CustomerBookedReservationsUnreadableError
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
      const loaded: DotyposReservation[] = [];
      let page = Option.some(1);
      // Every page read adds at least one reservation, so the loop reads at
      // most `limit + 1` pages.
      while (Option.isSome(page) && loaded.length <= input.limit) {
        const result = yield* dotypos.listReservationsPage({
          customerId: input.customerId,
          order: "startDateDescending",
          page: page.value,
        });
        if (result.reservations.length === 0 && Option.isSome(result.nextPage))
          return yield* inconsistentPages();
        loaded.push(...result.reservations);
        page = result.nextPage;
      }
      const bounded = yield* requireWithinReadLimit(loaded, input.limit);
      if (new Set(bounded.map(({ id }) => id)).size !== bounded.length)
        return yield* inconsistentPages();
      return yield* Effect.forEach(bounded, toCustomerBookedReservation);
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
