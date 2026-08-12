import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { AdministrationLive } from "./administration.runtime";
import {
  type AdministrationReservationListInput,
  AdministrationService,
} from "./administration.service";
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
  typeof value === "string" ? value : value?.[0];

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
      Effect.provide(AdministrationLive),
      runWorkspaceEffect(operation, { boundary: "route" })
    );

export const authorizeAdministrationPage = async () => {
  const authorized = await requireDiscountAdminAuthorization().pipe(
    Effect.as(true),
    Effect.catchTag("DiscountAdminUnauthorizedError", () =>
      Effect.succeed(false)
    ),
    runWorkspaceEffect("administration.authorize", { boundary: "route" })
  );
  if (!authorized) notFound();
};

export const loadAdministrationOverview = async () => {
  await authorizeAdministrationPage();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOverview();
  }).pipe(runAdministration("administration.overview"));
};

export const loadAdministrationReservations = async (
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
  const input: AdministrationReservationListInput = {
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
  };
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listReservations(input);
  }).pipe(runAdministration("administration.reservations"));
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

export const loadAdministrationBookings = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const input = {
    date: parseDate(firstParam(params.date)),
    page: parsePage(firstParam(params.page)),
  };
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listBookings(input);
  }).pipe(runAdministration("administration.bookings"));
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

export const loadAdministrationOrders = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const range = getAdministrationOrderDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listOrders({
      fromTime: range.fromTime,
      toTime: range.toTime,
      maxRecords: 50,
    });
  }).pipe(runAdministration("administration.orders"));
  return { range, result };
};

export const loadAdministrationOrder = cache(async (orderId: string) => {
  await authorizeAdministrationPage();
  const decodedOrderId = requireNexiOrderRouteId(orderId);
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOrder(decodedOrderId);
  }).pipe(runAdministration("administration.order"));
});

export const loadAdministrationOperations = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const range = getAdministrationPaymentDateTimeBounds(
    firstParam(params.from),
    firstParam(params.to)
  );
  const { channel, operationType } = getAdministrationOperationFilters({
    channel: firstParam(params.channel),
    operationType: firstParam(params.operationType),
  });
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listOperations({
      fromTime: range.fromTime,
      toTime: range.toTime,
      maxRecords: 100,
      channel,
      operationType,
    });
  }).pipe(runAdministration("administration.operations"));
  return { input: { channel, operationType }, range, result };
};

export const loadAdministrationOperation = cache(
  async (operationId: string) => {
    await authorizeAdministrationPage();
    const decodedOperationId = requireNexiOperationRouteId(operationId);
    return Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadOperation(decodedOperationId);
    }).pipe(runAdministration("administration.operation"));
  }
);
