import "server-only";

import { Effect, Predicate } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type AdministrationBookingListInput,
  type AdministrationCustomerListInput,
  type AdministrationReservationListInput,
  AdministrationService,
  getAdministrationReservationOverview,
} from "./administration.service";
import { formatAdministrationDateTime } from "./formatters";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "./payment-administration-filters";
import { getAdministrationReservationDateRange } from "./reservation-date-range";
import {
  getDotyposCustomerRouteId,
  requireDotyposCustomerRouteId,
  requireDotyposReservationRouteId,
  requireNexiOperationRouteId,
  requireNexiOrderRouteId,
  requireWorkspaceReservationRouteId,
} from "./route-identifiers.server";

export type AdministrationSearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

const firstParam = (value: string | readonly string[] | undefined) =>
  Predicate.isString(value) ? value : value?.[0];

const parsePage = (value: string | undefined) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
};

const parseDate = (value: string | undefined) => {
  if (!value) return getCurrentWorkspaceDate().toString();
  try {
    return Temporal.PlainDate.from(value).toString();
  } catch {
    return getCurrentWorkspaceDate().toString();
  }
};

const parseStatus = (
  value: string | undefined
): AdministrationReservationListInput["status"] =>
  value === "in_progress" || value === "complete" || value === "cancelled"
    ? value
    : undefined;

const parseReservationSort = (
  value: string | undefined
): NonNullable<AdministrationReservationListInput["sort"]> =>
  value === "date" || value === "reservation" || value === "status"
    ? value
    : "created";

const parseBookingSort = (
  value: string | undefined
): NonNullable<AdministrationBookingListInput["sort"]> =>
  value === "status" ? value : "booking";

const parseCustomerSort = (
  value: string | undefined
): NonNullable<AdministrationCustomerListInput["sort"]> =>
  value === "reservations" ? value : "activity";

const parseSortDirection = (
  value: string | undefined
): NonNullable<AdministrationReservationListInput["direction"]> =>
  value === "asc" ? "asc" : "desc";

const parseBookingSortDirection = (
  value: string | undefined
): NonNullable<AdministrationBookingListInput["direction"]> =>
  value === "desc" ? "desc" : "asc";

const runAdministration =
  (operation: string) =>
  <A, E>(effect: Effect.Effect<A, E, AdministrationService>) =>
    effect.pipe(
      Effect.provide(AdministrationService.Live),
      runWorkspaceEffect(operation, { boundary: "route" })
    );

const loadAdministrationOverviewSource = cache(async () => {
  await authorizeAdministratorPage();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOverviewSource();
  }).pipe(runAdministration("administration.overview-source"));
});

export const loadAdministrationOverview = async () => {
  const source = await loadAdministrationOverviewSource();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOverview(source);
  }).pipe(runAdministration("administration.overview"));
};

export const loadAdministrationReservationOverview = async () => {
  return getAdministrationReservationOverview(
    await loadAdministrationOverviewSource()
  );
};

const getAdministrationReservationListInput = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministratorPage();
  const params = await searchParams;
  const typeValue = firstParam(params.type);
  const dateRange = getAdministrationReservationDateRange({
    date: firstParam(params.date),
    from: firstParam(params.from),
    to: firstParam(params.to),
  });
  return {
    customerId: getDotyposCustomerRouteId(firstParam(params.customerId)),
    ...dateRange,
    direction: parseSortDirection(firstParam(params.direction)),
    page: parsePage(firstParam(params.page)),
    sort: parseReservationSort(firstParam(params.sort)),
    status: parseStatus(firstParam(params.status)),
    type:
      typeValue === "cowork" ||
      typeValue === "meeting-room" ||
      typeValue === "office"
        ? typeValue
        : undefined,
  } satisfies AdministrationReservationListInput;
};

const loadAdministrationReservationList = async (
  input: Promise<AdministrationReservationListInput>
) => {
  const [, resolvedInput] = await Promise.all([
    authorizeAdministratorPage(),
    input,
  ]);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listReservations(resolvedInput);
  }).pipe(runAdministration("administration.reservations"));
};

export const loadAdministrationReservationsPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationReservationListInput(searchParams);
  return { input, result: loadAdministrationReservationList(input) };
};

export const loadAdministrationReservations = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationReservationsPage(searchParams);
  const [input, result] = await Promise.all([page.input, page.result]);
  return { input, result };
};

export const loadAdministrationReservation = cache(async (id: string) => {
  await authorizeAdministratorPage();
  const reservationId = requireWorkspaceReservationRouteId(id);
  const detail = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadReservation(reservationId);
  }).pipe(runAdministration("administration.reservation"));
  if (!detail) notFound();
  return detail;
});

export const loadAdministrationReservationBreadcrumbLabel = cache(
  async (id: string) => {
    await authorizeAdministratorPage();
    const reservationId = requireWorkspaceReservationRouteId(id);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadReservationBreadcrumbLabel(
        reservationId
      );
    }).pipe(runAdministration("administration.reservation-breadcrumb"));
  }
);

const getAdministrationBookingListInput = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  return {
    date: parseDate(firstParam(params.date)),
    direction: parseBookingSortDirection(firstParam(params.direction)),
    page: parsePage(firstParam(params.page)),
    sort: parseBookingSort(firstParam(params.sort)),
  } satisfies AdministrationBookingListInput;
};

const loadAdministrationBookingList = async (
  input: ReturnType<typeof getAdministrationBookingListInput>
) => {
  const [, resolvedInput] = await Promise.all([
    authorizeAdministratorPage(),
    input,
  ]);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listBookings(resolvedInput);
  }).pipe(runAdministration("administration.bookings"));
};

export const loadAdministrationBookingsPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationBookingListInput(searchParams);
  return { input, result: loadAdministrationBookingList(input) };
};

export const loadAdministrationBookings = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationBookingsPage(searchParams);
  const [input, result] = await Promise.all([page.input, page.result]);
  return { input, result };
};

export const loadAdministrationBooking = cache(async (id: string) => {
  await authorizeAdministratorPage();
  const bookingId = requireDotyposReservationRouteId(id);
  const detail = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadBooking(bookingId);
  }).pipe(runAdministration("administration.booking"));
  if (!detail) notFound();
  return detail;
});

export const loadAdministrationBookingBreadcrumbLabel = cache(
  async (id: string) => {
    await authorizeAdministratorPage();
    const bookingId = requireDotyposReservationRouteId(id);
    const breadcrumb = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBookingBreadcrumb(bookingId);
    }).pipe(runAdministration("administration.booking-breadcrumb"));
    return breadcrumb
      ? (breadcrumb.tableName ??
          formatAdministrationDateTime(breadcrumb.startsAt))
      : undefined;
  }
);

const getAdministrationCustomerListInput = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  return {
    direction: parseSortDirection(firstParam(params.direction)),
    page: parsePage(firstParam(params.page)),
    sort: parseCustomerSort(firstParam(params.sort)),
  } satisfies AdministrationCustomerListInput;
};

const loadAdministrationCustomerList = async (
  input: ReturnType<typeof getAdministrationCustomerListInput>
) => {
  const [, resolvedInput] = await Promise.all([
    authorizeAdministratorPage(),
    input,
  ]);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listCustomers(resolvedInput);
  }).pipe(runAdministration("administration.customers"));
};

export const loadAdministrationCustomersPage = (
  searchParams: AdministrationSearchParams
) => {
  const input = getAdministrationCustomerListInput(searchParams);
  return { input, result: loadAdministrationCustomerList(input) };
};

export const loadAdministrationCustomers = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationCustomersPage(searchParams);
  const [input, result] = await Promise.all([page.input, page.result]);
  return { input, result };
};

export const loadAdministrationCustomerReservations = async (
  customerId: string,
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministratorPage();
  const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
  const params = await searchParams;
  const page = parsePage(firstParam(params.reservationsPage));
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadCustomerReservations({
      customerId: decodedCustomerId,
      page,
    });
  }).pipe(runAdministration("administration.customer-reservations"));
};

export const loadAdministrationCustomerActivity = cache(
  async (customerId: string) => {
    await authorizeAdministratorPage();
    const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerActivity(decodedCustomerId);
    }).pipe(runAdministration("administration.customer-activity"));
  }
);

export const loadAdministrationCustomerReservationActivity = cache(
  async (customerId: string) => {
    await authorizeAdministratorPage();
    const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerReservationActivity(
        decodedCustomerId
      );
    }).pipe(runAdministration("administration.customer-reservation-activity"));
  }
);

const getAdministrationOrderRange = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  return getAdministrationOrderDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
};

const loadAdministrationOrderList = async (
  range: ReturnType<typeof getAdministrationOrderRange>
) => {
  const [, resolvedRange] = await Promise.all([
    authorizeAdministratorPage(),
    range,
  ]);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listOrders({
      fromTime: resolvedRange.fromTime,
      toTime: resolvedRange.toTime,
      maxRecords: 50,
    });
  }).pipe(runAdministration("administration.orders"));
};

export const loadAdministrationOrdersPage = (
  searchParams: AdministrationSearchParams
) => {
  const range = getAdministrationOrderRange(searchParams);
  return { range, result: loadAdministrationOrderList(range) };
};

export const loadAdministrationOrders = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationOrdersPage(searchParams);
  const [range, result] = await Promise.all([page.range, page.result]);
  return { range, result };
};

export const loadAdministrationOrder = cache(async (orderId: string) => {
  await authorizeAdministratorPage();
  const decodedOrderId = requireNexiOrderRouteId(orderId);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOrder(decodedOrderId);
  }).pipe(runAdministration("administration.order"));
});

const getAdministrationOperationListInput = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  const range = getAdministrationPaymentDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
  const { channel, operationType } = getAdministrationOperationFilters({
    channel: firstParam(params.channel),
    operationType: firstParam(params.operationType),
  });
  return { input: { channel, operationType }, range };
};

const loadAdministrationOperationList = async (
  criteria: ReturnType<typeof getAdministrationOperationListInput>
) => {
  const [, resolvedCriteria] = await Promise.all([
    authorizeAdministratorPage(),
    criteria,
  ]);
  const { input, range } = resolvedCriteria;
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listOperations({
      fromTime: range.fromTime,
      toTime: range.toTime,
      maxRecords: 100,
      channel: input.channel,
      operationType: input.operationType,
    });
  }).pipe(runAdministration("administration.operations"));
};

export const loadAdministrationOperationsPage = (
  searchParams: AdministrationSearchParams
) => {
  const criteria = getAdministrationOperationListInput(searchParams);
  return { criteria, result: loadAdministrationOperationList(criteria) };
};

export const loadAdministrationOperations = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationOperationsPage(searchParams);
  const [{ input, range }, result] = await Promise.all([
    page.criteria,
    page.result,
  ]);
  return { input, range, result };
};

export const loadAdministrationOperation = cache(
  async (operationId: string) => {
    await authorizeAdministratorPage();
    const decodedOperationId = requireNexiOperationRouteId(operationId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadOperation(decodedOperationId);
    }).pipe(runAdministration("administration.operation"));
  }
);
