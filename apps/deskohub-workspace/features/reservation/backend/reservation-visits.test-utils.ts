import type { DotyposReservation } from "@deskohub/dotypos";
import { dotyposIdReadRequests } from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer, Option } from "effect";
import {
  type ReservationVisit,
  ReservationVisits,
  type ReservationVisitWindow,
} from "./reservation-visits.service";

/**
 * A `DotyposService` mock answering reservation reads from `reservations`
 * that counts every request and the most open at once. Each request yields
 * before answering, so concurrent requests overlap. Edit the array between
 * reads to change what Dotypos holds.
 */
export const countedDotyposReservationReads = (
  reservations: DotyposReservation[]
) => {
  let requests = 0;
  let open = 0;
  let peakOpen = 0;
  const reads = seededReservationReads(reservations);
  const counted = <A, E>(read: () => Effect.Effect<A, E>, cost = 1) =>
    Effect.suspend(() => {
      requests += cost;
      open += 1;
      peakOpen = Math.max(peakOpen, open);
      return Effect.yieldNow.pipe(
        Effect.andThen(read),
        Effect.ensuring(Effect.sync(() => (open -= 1)))
      );
    });
  return {
    layer: DotyposServiceMock({
      listReservations: (options) =>
        counted(() => reads.listReservations(options)),
      getReservationsByIds: (ids, options) =>
        counted(
          () => reads.getReservationsByIds(ids, options),
          dotyposIdReadRequests(new Set(ids).size)
        ),
      listReservationsPage: (options) =>
        counted(() => reads.listReservationsPage(options)),
      listActiveReservationsPage: (interval, page) =>
        counted(() => reads.listActiveReservationsPage(interval, page)),
    }),
    requests: () => requests,
    peakOpenRequests: () => peakOpen,
  };
};

const fakePageSize = 100;

/**
 * `ReservationVisits` answering from `visits`, as if each were a
 * Workspace-booked reservation Dotypos returns. `activeDuring` pages the
 * active visits overlapping the window by 100.
 */
export const reservationVisitsFake = (
  visits: readonly ReservationVisit[]
): Layer.Layer<ReservationVisits> =>
  Layer.succeed(
    ReservationVisits,
    ReservationVisits.of({
      ofReservations: (ids) =>
        Effect.succeed(
          new Map(
            ids.map((id) => [
              id,
              Option.fromUndefinedOr(
                visits.find((visit) => visit.workspaceReservationId === id)
              ),
            ])
          )
        ),
      ofCustomers: (ids) =>
        Effect.succeed(
          new Map(ids.map((id) => [id, customerVisits(visits, id)]))
        ),
      activeDuring: (window, page) =>
        Effect.sync(() => {
          const active = visits.filter((visit) =>
            isActiveDuring(visit, window)
          );
          const end = page * fakePageSize;
          return {
            visits: active.slice(end - fakePageSize, end),
            nextPage:
              end < active.length ? Option.some(page + 1) : Option.none(),
          };
        }),
      bookings: (customers) =>
        Effect.succeed(
          new Map(
            customers.flatMap((id) => {
              const booked = customerVisits(visits, id).length;
              return booked === 0 ? [] : [[id, booked] as const];
            })
          )
        ),
      cost: (customers) =>
        Effect.succeed(
          Math.ceil(
            customers.flatMap((id) => customerVisits(visits, id)).length / 100
          )
        ),
    })
  );

const customerVisits = (
  visits: readonly ReservationVisit[],
  customerId: ReservationVisit["dotyposCustomerId"]
) => visits.filter((visit) => visit.dotyposCustomerId === customerId);

const isActiveDuring = (
  visit: ReservationVisit,
  window: ReservationVisitWindow
) =>
  visit.status === "active" &&
  Temporal.Instant.compare(window.startsAt, visit.endsAt) < 0 &&
  Temporal.Instant.compare(visit.startsAt, window.endsAt) < 0;
