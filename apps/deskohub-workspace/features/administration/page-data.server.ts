import "server-only";

import { Effect, Predicate } from "effect";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type AdministrationReservationListInput,
  AdministrationService,
} from "./administration.service";
import { formatAdministrationDateTime } from "./formatters";
import {
  getAdministrationNexiOperationFilters,
  getAdministrationNexiOrderDateTimeBounds,
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

const parseSortDirection = (
  value: string | undefined
): NonNullable<AdministrationReservationListInput["direction"]> =>
  value === "asc" ? "asc" : "desc";

const runAdministration =
  (operation: string) =>
  <A, E>(effect: Effect.Effect<A, E, AdministrationService>) =>
    effect.pipe(
      Effect.provide(AdministrationService.Live),
      runWorkspaceEffect(operation, { boundary: "route" })
    );

export const authorizeAdministrationPage = cache(async () => {
  const authorized = await requireDiscountAdminAuthorization().pipe(
    Effect.as(true),
    Effect.catchTag("DiscountAdminUnauthorizedError", () =>
      Effect.succeed(false)
    ),
    runWorkspaceEffect("administration.authorize", { boundary: "route" })
  );
  if (!authorized) notFound();
  await connection();
});

export const loadAdministrationOverview = async () => {
  await authorizeAdministrationPage();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOverview();
  }).pipe(runAdministration("administration.overview"));
};

const getAdministrationReservationListInput = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
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
    authorizeAdministrationPage(),
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
  await authorizeAdministrationPage();
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
    await authorizeAdministrationPage();
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
    page: parsePage(firstParam(params.page)),
  };
};

const loadAdministrationBookingList = async (
  input: ReturnType<typeof getAdministrationBookingListInput>
) => {
  const [, resolvedInput] = await Promise.all([
    authorizeAdministrationPage(),
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
  await authorizeAdministrationPage();
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
    await authorizeAdministrationPage();
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

export const loadAdministrationCustomers = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listCustomers({
      page: parsePage(firstParam(params.page)),
    });
  }).pipe(runAdministration("administration.customers"));
};

export const loadAdministrationCustomerReservations = async (
  customerId: string,
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
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
    await authorizeAdministrationPage();
    const decodedCustomerId = requireDotyposCustomerRouteId(customerId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerActivity(decodedCustomerId);
    }).pipe(runAdministration("administration.customer-activity"));
  }
);

const getAdministrationNexiOrderRange = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  return getAdministrationNexiOrderDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
};

const loadAdministrationNexiOrderList = async (
  range: ReturnType<typeof getAdministrationNexiOrderRange>
) => {
  const [, resolvedRange] = await Promise.all([
    authorizeAdministrationPage(),
    range,
  ]);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listNexiOrders({
      fromTime: resolvedRange.fromTime,
      toTime: resolvedRange.toTime,
      maxRecords: 50,
    });
  }).pipe(runAdministration("administration.nexi-orders"));
};

export const loadAdministrationNexiOrdersPage = (
  searchParams: AdministrationSearchParams
) => {
  const range = getAdministrationNexiOrderRange(searchParams);
  return { range, result: loadAdministrationNexiOrderList(range) };
};

export const loadAdministrationNexiOrders = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationNexiOrdersPage(searchParams);
  const [range, result] = await Promise.all([page.range, page.result]);
  return { range, result };
};

export const loadAdministrationNexiOrder = cache(async (orderId: string) => {
  await authorizeAdministrationPage();
  const decodedOrderId = requireNexiOrderRouteId(orderId);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadNexiOrder(decodedOrderId);
  }).pipe(runAdministration("administration.nexi-order"));
});

const getAdministrationNexiOperationListInput = async (
  searchParams: AdministrationSearchParams
) => {
  const params = await searchParams;
  const range = getAdministrationPaymentDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
  const { channel, operationType } = getAdministrationNexiOperationFilters({
    channel: firstParam(params.channel),
    operationType: firstParam(params.operationType),
  });
  return { input: { channel, operationType }, range };
};

const loadAdministrationNexiOperationList = async (
  criteria: ReturnType<typeof getAdministrationNexiOperationListInput>
) => {
  const [, resolvedCriteria] = await Promise.all([
    authorizeAdministrationPage(),
    criteria,
  ]);
  const { input, range } = resolvedCriteria;
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listNexiOperations({
      fromTime: range.fromTime,
      toTime: range.toTime,
      maxRecords: 100,
      channel: input.channel,
      operationType: input.operationType,
    });
  }).pipe(runAdministration("administration.nexi-operations"));
};

export const loadAdministrationNexiOperationsPage = (
  searchParams: AdministrationSearchParams
) => {
  const criteria = getAdministrationNexiOperationListInput(searchParams);
  return { criteria, result: loadAdministrationNexiOperationList(criteria) };
};

export const loadAdministrationNexiOperations = async (
  searchParams: AdministrationSearchParams
) => {
  const page = loadAdministrationNexiOperationsPage(searchParams);
  const [{ input, range }, result] = await Promise.all([
    page.criteria,
    page.result,
  ]);
  return { input, range, result };
};

export const loadAdministrationNexiOperation = cache(
  async (operationId: string) => {
    await authorizeAdministrationPage();
    const decodedOperationId = requireNexiOperationRouteId(operationId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadNexiOperation(decodedOperationId);
    }).pipe(runAdministration("administration.nexi-operation"));
  }
);
