import "server-only";

import { Effect, Layer, Option, Schema } from "effect";
import { cache } from "react";
import type { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";
import {
  type AdministrationReservationListInput,
  AdministrationService,
  getAdministrationReservationOverview,
} from "./administration.service";
import { bookingListQuery } from "./booking-list-query";
import { customerListQuery } from "./customer-list-query";
import { formatAdministrationDateTime } from "./formatters";
import { listPageParam } from "./list-query";
import { operationListQuery } from "./operation-list-query";
import { orderListQuery } from "./order-list-query";
import { reservationListQuery } from "./reservation-list-query";
import { getAdministrationReservationProductTitle } from "./reservation-product";
import {
  decodeDotyposCustomerRouteId,
  decodeDotyposReservationRouteId,
  decodeNexiOperationRouteId,
  decodeNexiOrderRouteId,
  decodeWorkspaceReservationRouteId,
} from "./route-identifiers.server";

export type AdministrationSearchParams = Promise<SearchParamsRecord>;

const decodeCustomerReservationsPage = getSearchParamsDecoder(
  Schema.Struct({ reservationsPage: listPageParam })
);

/** Runs an administration page query against the administration service. */
const runAdministration = <A, E>(
  operation: string,
  query: Effect.Effect<
    A,
    E | AdministrationRecordNotFound,
    AdministrationService | CurrentAdministrator
  >
) => runAdministrationPage(operation, query, AdministrationService.Live);

const loadAdministrationOverviewSource = cache(() =>
  runAdministration(
    "administration.overview-source",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadOverviewSource();
    })
  )
);

export const loadAdministrationOverview = async () => {
  const source = await loadAdministrationOverviewSource();
  return runAdministration(
    "administration.overview",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadOverview(source);
    })
  );
};

export const loadAdministrationRefundAttention = cache(() =>
  runAdministration(
    "administration.refund-attention",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.countReservationsNeedingRefund();
    })
  )
);

export const loadAdministrationReservationActivity = cache(() =>
  runAdministration(
    "administration.reservation-activity",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservationActivity();
    })
  )
);

export const loadAdministrationReservationOverview = async () => {
  return getAdministrationReservationOverview(
    await loadAdministrationOverviewSource()
  );
};

const getAdministrationReservationListInput = (
  searchParams: AdministrationSearchParams
) =>
  runAdministrationPage(
    "administration.reservations-input",
    Effect.promise(() => searchParams).pipe(
      Effect.map(reservationListQuery.parse)
    ),
    Layer.empty
  );

const loadAdministrationReservationList = async (
  input: Promise<AdministrationReservationListInput>
) => {
  const resolvedInput = await input;
  return runAdministration(
    "administration.reservations",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listReservations(resolvedInput);
    })
  );
};

export const loadAdministrationReservationsPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationReservationListInput(searchParams);
  return { input, result: loadAdministrationReservationList(input) };
};

export const loadAdministrationReservation = cache((id: string) =>
  runAdministration(
    "administration.reservation",
    Effect.gen(function* () {
      const reservationId = yield* decodeWorkspaceReservationRouteId(id);
      const administration = yield* AdministrationService;
      const detail = yield* administration.loadReservation(reservationId);
      if (!detail) return yield* new AdministrationRecordNotFound();
      return detail;
    })
  )
);

export const loadAdministrationReservationBreadcrumbLabel = cache(
  async (id: string, locale: Locale) => {
    const product = await runAdministration(
      "administration.reservation-breadcrumb",
      Effect.gen(function* () {
        const reservationId = yield* decodeWorkspaceReservationRouteId(id);
        const administration = yield* AdministrationService;
        return yield* administration.loadReservationProduct(reservationId);
      })
    );
    return product && getAdministrationReservationProductTitle(product, locale);
  }
);

const getAdministrationBookingListInput = async (
  searchParams: AdministrationSearchParams
) => bookingListQuery.parse(await searchParams);

const loadAdministrationBookingList = async (
  input: ReturnType<typeof getAdministrationBookingListInput>
) => {
  const resolvedInput = await input;
  return runAdministration(
    "administration.bookings",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listBookings(resolvedInput);
    })
  );
};

export const loadAdministrationBookingsPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationBookingListInput(searchParams);
  return { input, result: loadAdministrationBookingList(input) };
};

export const loadAdministrationBooking = cache((id: string) =>
  runAdministration(
    "administration.booking",
    Effect.gen(function* () {
      const bookingId = yield* decodeDotyposReservationRouteId(id);
      const administration = yield* AdministrationService;
      const detail = yield* administration.loadBooking(bookingId);
      if (!detail) return yield* new AdministrationRecordNotFound();
      return detail;
    })
  )
);

export const loadAdministrationBookingBreadcrumbLabel = cache(
  async (id: string, locale: Locale) => {
    const breadcrumb = await runAdministration(
      "administration.booking-breadcrumb",
      Effect.gen(function* () {
        const bookingId = yield* decodeDotyposReservationRouteId(id);
        const administration = yield* AdministrationService;
        return yield* administration.loadBookingBreadcrumb(bookingId);
      })
    );
    return breadcrumb
      ? (breadcrumb.tableName ??
          formatAdministrationDateTime(breadcrumb.startsAt, locale))
      : undefined;
  }
);

const getAdministrationCustomerListInput = (
  searchParams: AdministrationSearchParams
) =>
  runAdministrationPage(
    "administration.customers-input",
    Effect.promise(() => searchParams).pipe(
      Effect.map(customerListQuery.parse)
    ),
    Layer.empty
  );

const loadAdministrationCustomerList = async (
  input: ReturnType<typeof getAdministrationCustomerListInput>
) => {
  const resolvedInput = await input;
  return runAdministration(
    "administration.customers",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listCustomers(resolvedInput);
    })
  );
};

export const loadAdministrationCustomersPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationCustomerListInput(searchParams);
  return { input, result: loadAdministrationCustomerList(input) };
};

export const loadAdministrationCustomerReservations = (
  customerId: string,
  searchParams: AdministrationSearchParams
) =>
  runAdministration(
    "administration.customer-reservations",
    Effect.gen(function* () {
      const decodedCustomerId = yield* decodeDotyposCustomerRouteId(customerId);
      const params = yield* Effect.promise(() => searchParams);
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerReservations({
        customerId: decodedCustomerId,
        // The page falls back to the first, so decoding never fails.
        page: Option.getOrThrow(decodeCustomerReservationsPage(params))
          .reservationsPage,
      });
    })
  );

export const loadAdministrationCustomerActivity = cache((customerId: string) =>
  runAdministration(
    "administration.customer-activity",
    Effect.gen(function* () {
      const decodedCustomerId = yield* decodeDotyposCustomerRouteId(customerId);
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerActivity(decodedCustomerId);
    })
  )
);

export const loadAdministrationCustomerReservationActivity = cache(
  (customerId: string) =>
    runAdministration(
      "administration.customer-reservation-activity",
      Effect.gen(function* () {
        const decodedCustomerId =
          yield* decodeDotyposCustomerRouteId(customerId);
        const administration = yield* AdministrationService;
        return yield* administration.loadCustomerReservationActivity(
          decodedCustomerId
        );
      })
    )
);

const getAdministrationOrderRange = async (
  searchParams: AdministrationSearchParams
) => orderListQuery.parse(await searchParams);

const loadAdministrationOrderList = async (
  range: ReturnType<typeof getAdministrationOrderRange>
) => {
  const resolvedRange = await range;
  return runAdministration(
    "administration.orders",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listOrders({
        fromTime: resolvedRange.fromTime,
        toTime: resolvedRange.toTime,
        maxRecords: 50,
      });
    })
  );
};

export const loadAdministrationOrdersPage = (
  searchParams: AdministrationSearchParams
) => {
  const range = getAdministrationOrderRange(searchParams);
  return { range, result: loadAdministrationOrderList(range) };
};

export const loadAdministrationOrder = cache((orderId: string) =>
  runAdministration(
    "administration.order",
    Effect.gen(function* () {
      const decodedOrderId = yield* decodeNexiOrderRouteId(orderId);
      const administration = yield* AdministrationService;
      return yield* administration.loadOrder(decodedOrderId);
    })
  )
);

const getAdministrationOperationListInput = async (
  searchParams: AdministrationSearchParams
) => operationListQuery.parse(await searchParams);

const loadAdministrationOperationList = async (
  criteria: ReturnType<typeof getAdministrationOperationListInput>
) => {
  const query = await criteria;
  return runAdministration(
    "administration.operations",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listOperations({
        fromTime: query.fromTime,
        toTime: query.toTime,
        maxRecords: 100,
        channel: query.channel,
        operationType: query.operationType,
      });
    })
  );
};

export const loadAdministrationOperationsPage = (
  searchParams: AdministrationSearchParams
) => {
  const criteria = getAdministrationOperationListInput(searchParams);
  return { criteria, result: loadAdministrationOperationList(criteria) };
};

export const loadAdministrationOperation = cache((operationId: string) =>
  runAdministration(
    "administration.operation",
    Effect.gen(function* () {
      const decodedOperationId = yield* decodeNexiOperationRouteId(operationId);
      const administration = yield* AdministrationService;
      return yield* administration.loadOperation(decodedOperationId);
    })
  )
);
