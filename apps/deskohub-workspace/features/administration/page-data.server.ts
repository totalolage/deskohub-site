import "server-only";

import { Effect, Layer, Option, Predicate } from "effect";
import { cache } from "react";
import type { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { parsePlainDate } from "@/shared/utils/temporal";
import {
  type AdministrationBookingListInput,
  type AdministrationCustomerExportInput,
  type AdministrationCustomerListInput,
  type AdministrationReservationExportInput,
  type AdministrationReservationListInput,
  AdministrationService,
  getAdministrationReservationOverview,
} from "./administration.service";
import { parseAdministrationCustomerMarketingConsentState } from "./customer-list-filters";
import { formatAdministrationDateTime } from "./formatters";
import {
  getAdministrationOperationFilters,
  getAdministrationOrderDateTimeBounds,
  getAdministrationPaymentDateTimeBounds,
} from "./payment-administration-filters";
import {
  getAdministrationReservationDateRange,
  getAdministrationReservationListDateRange,
} from "./reservation-date-range";
import { getAdministrationReservationProductTitle } from "./reservation-product";
import {
  decodeDotyposCustomerRouteId,
  decodeDotyposReservationRouteId,
  decodeNexiOperationRouteId,
  decodeNexiOrderRouteId,
  decodeWorkspaceReservationRouteId,
  getDotyposCustomerRouteId,
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

const parseDate = (value: string | undefined) =>
  Option.fromNullishOr(value)
    .pipe(
      Option.flatMap(parsePlainDate),
      Option.getOrElse(() => getCurrentWorkspaceDate())
    )
    .toString();

const parseStatus = (
  value: string | undefined
): AdministrationReservationListInput["status"] =>
  value === "in_progress" ||
  value === "complete" ||
  value === "cancelled" ||
  value === "needs_refund"
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

/**
 * The reservation list input that the page and its export derive from the
 * same URL, including the default date range.
 */
export const parseAdministrationReservationListSearchParams = (
  params: Awaited<AdministrationSearchParams>
) => {
  const typeValue = firstParam(params.type);
  const customerId = getDotyposCustomerRouteId(firstParam(params.customerId));
  const status = parseStatus(firstParam(params.status));
  const dateRange = getAdministrationReservationListDateRange({
    customerId,
    date: firstParam(params.date),
    from: firstParam(params.from),
    status,
    to: firstParam(params.to),
  });
  return {
    customerId,
    ...dateRange,
    direction: parseSortDirection(firstParam(params.direction)),
    page: parsePage(firstParam(params.page)),
    sort: parseReservationSort(firstParam(params.sort)),
    status,
    type:
      typeValue === "cowork" ||
      typeValue === "meeting-room" ||
      typeValue === "office"
        ? typeValue
        : undefined,
  } satisfies AdministrationReservationListInput;
};

/** The reservation export reads the list's filters and order, but no page. */
export const parseAdministrationReservationExportSearchParams = (
  params: Awaited<AdministrationSearchParams>
): AdministrationReservationExportInput => {
  const { page: _, ...input } =
    parseAdministrationReservationListSearchParams(params);
  return input;
};

const getAdministrationReservationListInput = (
  searchParams: AdministrationSearchParams
) =>
  runAdministrationPage(
    "administration.reservations-input",
    Effect.promise(() => searchParams).pipe(
      Effect.map(parseAdministrationReservationListSearchParams)
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

/**
 * Parses the customer list's URL parameters. The list has no default date
 * range: without `from` or `to` it covers every customer.
 */
export const parseAdministrationCustomerListSearchParams = (
  params: Awaited<AdministrationSearchParams>
) =>
  ({
    ...getAdministrationReservationDateRange({
      from: firstParam(params.from),
      to: firstParam(params.to),
    }),
    direction: parseSortDirection(firstParam(params.direction)),
    marketingConsent: parseAdministrationCustomerMarketingConsentState(
      firstParam(params.marketingConsent)
    ),
    page: parsePage(firstParam(params.page)),
    sort: parseCustomerSort(firstParam(params.sort)),
  }) satisfies AdministrationCustomerListInput;

/** The customer export reads the list's filters and order, but no page. */
export const parseAdministrationCustomerExportSearchParams = (
  params: Awaited<AdministrationSearchParams>
): AdministrationCustomerExportInput => {
  const { page: _, ...input } =
    parseAdministrationCustomerListSearchParams(params);
  return input;
};

const getAdministrationCustomerListInput = (
  searchParams: AdministrationSearchParams
) =>
  runAdministrationPage(
    "administration.customers-input",
    Effect.promise(() => searchParams).pipe(
      Effect.map(parseAdministrationCustomerListSearchParams)
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
        page: parsePage(firstParam(params.reservationsPage)),
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
  const { input, range } = await criteria;
  return runAdministration(
    "administration.operations",
    Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.listOperations({
        fromTime: range.fromTime,
        toTime: range.toTime,
        maxRecords: 100,
        channel: input.channel,
        operationType: input.operationType,
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
