import type { DotyposReservation } from "@deskohub/dotypos";
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
 * that counts every request. Edit the array between reads to change what
 * Dotypos holds.
 */
export const countedDotyposReservationReads = (
  reservations: DotyposReservation[]
) => {
  let requests = 0;
  const reads = seededReservationReads(reservations);
  const counted = <A, E>(read: () => Effect.Effect<A, E>) =>
    Effect.suspend(() => {
      requests += 1;
      return read();
    });
  return {
    layer: DotyposServiceMock({
      listReservations: (options) =>
        counted(() => reads.listReservations(options)),
      listReservationsPage: (options) =>
        counted(() => reads.listReservationsPage(options)),
      listActiveReservationsPage: (interval, page) =>
        counted(() => reads.listActiveReservationsPage(interval, page)),
    }),
    requests: () => requests,
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
      cost: (customers) =>
        Effect.succeed(
          Math.ceil(
            customers.flatMap((id) => customerVisits(visits, id)).length / 50
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
