import { Effect, Layer, Option } from "effect";
import type {
  DotyposCustomer,
  DotyposReservation,
  DotyposReservationInterval,
} from "../types";
import {
  DotyposService,
  dotyposMaximumPageSize,
  type ReservationListOptions,
  type ReservationPage,
} from "./service";

export const DotyposServiceMock = Layer.mock(DotyposService);

/** A mock customer ID read that selects matching seeded customers. */
export const seededCustomerReads = (
  customers: readonly DotyposCustomer[]
): Pick<DotyposService["Service"], "getCustomersPage"> => ({
  getCustomersPage: (ids) => {
    const selectedIds = new Set<string>(ids);
    return Effect.succeed(
      customers.filter(
        (customer) => customer.id !== undefined && selectedIds.has(customer.id)
      )
    );
  },
});

/**
 * Reservation reads that answer from `reservations` with the filters, order,
 * and 100-record pages Dotypos applies. Start filters take ISO instants.
 * Spread them into `DotyposServiceMock`.
 */
export const seededReservationReads = (
  reservations: readonly DotyposReservation[]
): Pick<
  DotyposService["Service"],
  "listReservations" | "listReservationsPage" | "listActiveReservationsPage"
> => {
  const select = (options: ReservationListOptions) => {
    const ids = options.ids && new Set<string>(options.ids);
    const startsAtOrAfter = parseInstant(options.startsAtOrAfter);
    const startsBefore = parseInstant(options.startsBefore);
    const selected = reservations.filter((reservation) => {
      const startsAt = Date.parse(reservation.startDate);
      return (
        (!ids || (reservation.id !== undefined && ids.has(reservation.id))) &&
        (!options.customerId ||
          reservation._customerId === options.customerId) &&
        (startsAtOrAfter === undefined || startsAt >= startsAtOrAfter) &&
        (startsBefore === undefined || startsAt < startsBefore)
      );
    });
    if (!options.order) return selected;
    const direction = options.order === "startDateAscending" ? 1 : -1;
    return selected.toSorted(
      (left, right) =>
        direction * (Date.parse(left.startDate) - Date.parse(right.startDate))
    );
  };

  const selectActive = (interval: DotyposReservationInterval) =>
    reservations.filter(
      (reservation) =>
        (reservation.status === "NEW" || reservation.status === "CONFIRMED") &&
        Date.parse(reservation.startDate) < interval.endDate.getTime() &&
        Date.parse(reservation.endDate) > interval.startDate.getTime()
    );

  return {
    listReservations: (options = {}) => Effect.sync(() => select(options)),
    listReservationsPage: ({ page, ...options }) =>
      Effect.sync(() => pageOf(select(options), page)),
    listActiveReservationsPage: (interval, page) =>
      Effect.sync(() => pageOf(selectActive(interval), page)),
  };
};

const pageOf = (
  selected: readonly DotyposReservation[],
  page: number
): ReservationPage => {
  const start = (page - 1) * dotyposMaximumPageSize;
  const end = start + dotyposMaximumPageSize;
  return {
    reservations: selected.slice(start, end),
    nextPage: end < selected.length ? Option.some(page + 1) : Option.none(),
  };
};

const parseInstant = (value: string | undefined) =>
  value === undefined ? undefined : Date.parse(value);
