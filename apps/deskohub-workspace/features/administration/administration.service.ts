import { DotyposService } from "@deskohub/dotypos";
import type {
  Customer as DotyposCustomer,
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  inArray,
  isNotNull,
  max,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  discountApplications,
  legalEvidenceEvents,
  type PaymentAttemptState,
  paymentAttempts,
  type WorkspaceReservation,
  webhookEvents,
  workspaceReservations,
} from "@/db/schema";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  filterAdministrationReservationsByStatus,
  getAdministrationPagination,
} from "./listing";
import {
  type AdministrationOrder,
  type IPaymentAdministrationService,
  PaymentAdministrationService,
} from "./payment-administration.service";
import {
  getProviderOperationTimelineTone,
  getProviderValueLabel,
} from "./payment-presentation";
import {
  mergeReservationHistory,
  PostHogReservationHistory,
} from "./posthog-reservation-history";
import { getUniqueReservationId } from "./reservation-lookup.server";
import type { AdministrationStatusGroup } from "./reservation-status";
import {
  getAdministrationReservationLifecycle,
  getAdministrationReservationStatus,
} from "./reservation-status";

const reservationPageSize = 24;
const bookingPageSize = 24;
const customerPageSize = 24;
const customerReservationPageSize = 10;

const paymentAttemptStateLabels = {
  created: "Started",
  pending: "Pending",
  paid: "Paid",
  failed: "Unsuccessful",
  cancelled: "Unsuccessful",
  expired: "Unsuccessful",
} as const;

export type AdministrationReservationListInput = {
  readonly customerId?: string;
  readonly date?: string;
  readonly page?: number;
  readonly status?: Exclude<AdministrationStatusGroup, "attention">;
  readonly type?: "cowork" | "meeting-room";
};

type ReservationListInput = AdministrationReservationListInput & {
  readonly pageSize?: number;
};

export type AdministrationCustomerListInput = {
  readonly page?: number;
};

export type AdministrationCustomer = {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
};

export type AdministrationReservationSummary = {
  readonly id: string;
  readonly customerId: string;
  readonly customer: AdministrationCustomer | null;
  readonly liveDetailsAvailable: boolean;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly date: string | null;
  readonly type: "cowork" | "meeting-room";
  readonly typeLabel: string;
  readonly status: ReturnType<typeof getAdministrationReservationStatus>;
  readonly createdAt: string;
  readonly latestPayment: AdministrationPaymentAttempt | null;
  readonly updatedAt: string;
};

export type AdministrationReservationPage = {
  readonly items: readonly AdministrationReservationSummary[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

export type AdministrationBookingSummary = {
  readonly id: string;
  readonly customerId: string | null;
  readonly customer: AdministrationCustomer | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly seats: string;
  readonly status: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly statusLabel: string;
  readonly tableId: string | null;
  readonly tableName: string | null;
  readonly tableLocation: string | null;
  readonly linkedReservation: {
    readonly id: string;
    readonly label: string;
  } | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export type AdministrationBookingPage = {
  readonly items: readonly AdministrationBookingSummary[];
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
};

export type AdministrationBookingDetail = {
  readonly booking: AdministrationBookingSummary;
  readonly references: {
    readonly bookingId: string;
    readonly customerId: string | null;
    readonly workspaceReservationId: string | null;
  };
};

export type AdministrationPaymentAttempt = {
  readonly id: string;
  readonly state: PaymentAttemptState;
  readonly providerOrderId: string | null;
  readonly providerLabel: string;
  readonly stateLabel: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
  readonly createdAt: string;
  readonly providerOrderCreatedAt: string | null;
  readonly updatedAt: string;
};

export type AdministrationMoney = {
  readonly value: number;
  readonly exponent: number;
  readonly currency: string;
};

export type AdministrationCustomerTransaction = {
  readonly attempt: AdministrationPaymentAttempt;
  readonly reservation: AdministrationReservationSummary;
};

export type AdministrationCustomerConsent = {
  readonly documentKey: "privacyPolicy" | "marketingCommunications";
  readonly documentPath: string;
  readonly documentHash: string;
  readonly accepted: boolean;
  readonly acceptedAt: string;
  readonly locale: string;
};

export type AdministrationCustomerActivity = {
  readonly reservations: readonly AdministrationReservationSummary[];
  readonly transactions: readonly AdministrationCustomerTransaction[];
  readonly stats: {
    readonly reservationCount: number;
    readonly favoriteProduct: string | null;
    readonly revenue: readonly AdministrationMoney[];
    readonly discountSavings: readonly AdministrationMoney[];
  };
  readonly consents: readonly AdministrationCustomerConsent[];
};

export type AdministrationDiscountApplication = {
  readonly id: string;
  readonly label: string;
  readonly amount: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  };
};

export type AdministrationTimelineItem = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly occurredAt: string;
  readonly tone: "neutral" | "positive" | "warning";
  readonly href?: string;
};

export type AdministrationReservationDetail = {
  readonly reservation: AdministrationReservationSummary;
  readonly booking: AdministrationBookingSummary | null;
  readonly lifecycle: ReturnType<typeof getAdministrationReservationLifecycle>;
  readonly timeline: readonly AdministrationTimelineItem[];
  readonly paymentAttempts: readonly AdministrationPaymentAttempt[];
  readonly orders: readonly AdministrationOrder[];
  readonly discounts: readonly AdministrationDiscountApplication[];
  readonly otherCustomerReservations: readonly AdministrationReservationSummary[];
  readonly sameDateReservations: readonly AdministrationReservationSummary[];
  readonly references: {
    readonly workspaceReservationId: string;
    readonly dotyposReservationId: string | null;
    readonly customerId: string;
  };
};

export type AdministrationCustomerSummary = {
  readonly customer: AdministrationCustomer | null;
  readonly customerId: string;
  readonly reservationCount: number;
  readonly lastActivityAt: string;
};

export type AdministrationOverviewMetric = {
  readonly unavailable: boolean;
  readonly value: number;
};

type SafeReservationRow = Pick<
  WorkspaceReservation,
  | "id"
  | "dotyposCustomerId"
  | "dotyposReservationId"
  | "reservationState"
  | "paymentState"
  | "fulfillmentState"
  | "reservationDetails"
  | "reservationCreatedAt"
  | "reservationConfirmedAt"
  | "reservationCancelledAt"
  | "reservationHoldExpiredAt"
  | "paidAt"
  | "fulfilledAt"
  | "fulfillmentFailedAt"
  | "createdAt"
  | "updatedAt"
>;

const safeReservationSelection = {
  id: workspaceReservations.id,
  dotyposCustomerId: workspaceReservations.dotyposCustomerId,
  dotyposReservationId: workspaceReservations.dotyposReservationId,
  reservationState: workspaceReservations.reservationState,
  paymentState: workspaceReservations.paymentState,
  fulfillmentState: workspaceReservations.fulfillmentState,
  reservationDetails: workspaceReservations.reservationDetails,
  reservationCreatedAt: workspaceReservations.reservationCreatedAt,
  reservationConfirmedAt: workspaceReservations.reservationConfirmedAt,
  reservationCancelledAt: workspaceReservations.reservationCancelledAt,
  reservationHoldExpiredAt: workspaceReservations.reservationHoldExpiredAt,
  paidAt: workspaceReservations.paidAt,
  fulfilledAt: workspaceReservations.fulfilledAt,
  fulfillmentFailedAt: workspaceReservations.fulfillmentFailedAt,
  createdAt: workspaceReservations.createdAt,
  updatedAt: workspaceReservations.updatedAt,
} as const;

const toIsoString = (instant: Temporal.Instant) => instant.toString();

const toCustomer = (
  customer: DotyposCustomer,
  fallbackId: string
): AdministrationCustomer => {
  const personalName = [customer.firstName, customer.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: customer.id ?? fallbackId,
    displayName:
      personalName || customer.companyName?.trim() || "Unnamed customer",
    email: customer.email?.trim() || null,
    phone: customer.phone?.trim() || null,
  };
};

type SafePaymentAttemptRow = {
  readonly id: string;
  readonly workspaceReservationId: string;
  readonly providerOrderId: string | null;
  readonly provider: "internal" | "nexi";
  readonly state: PaymentAttemptState;
  readonly amountValue: number;
  readonly amountExponent: number;
  readonly currency: string;
  readonly createdAt: Temporal.Instant;
  readonly providerOrderCreatedAt: Temporal.Instant | null;
  readonly updatedAt: Temporal.Instant;
};

const safePaymentAttemptSelection = {
  id: paymentAttempts.id,
  workspaceReservationId: paymentAttempts.workspaceReservationId,
  providerOrderId: paymentAttempts.providerOrderId,
  provider: paymentAttempts.provider,
  state: paymentAttempts.state,
  amountValue: paymentAttempts.amountValue,
  amountExponent: paymentAttempts.amountExponent,
  currency: paymentAttempts.currency,
  createdAt: paymentAttempts.createdAt,
  providerOrderCreatedAt: paymentAttempts.providerOrderCreatedAt,
  updatedAt: paymentAttempts.updatedAt,
} as const;

const toAdministrationPaymentAttempt = (
  attempt: SafePaymentAttemptRow
): AdministrationPaymentAttempt => ({
  id: attempt.id,
  state: attempt.state,
  providerOrderId: attempt.providerOrderId,
  providerLabel:
    attempt.provider === "internal" ? "Included" : "Online payment",
  stateLabel: paymentAttemptStateLabels[attempt.state],
  amount: {
    value: attempt.amountValue,
    exponent: attempt.amountExponent,
    currency: attempt.currency,
  },
  createdAt: toIsoString(attempt.createdAt),
  providerOrderCreatedAt: attempt.providerOrderCreatedAt?.toString() ?? null,
  updatedAt: toIsoString(attempt.updatedAt),
});

const sumMoney = (
  items: readonly {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  }[]
): readonly AdministrationMoney[] => {
  const totals = new Map<string, AdministrationMoney>();
  for (const item of items) {
    const key = `${item.currency}:${item.exponent}`;
    const current = totals.get(key);
    totals.set(key, {
      ...item,
      value: (current?.value ?? 0) + item.value,
    });
  }
  return [...totals.values()].toSorted((left, right) =>
    left.currency.localeCompare(right.currency)
  );
};

const getFavoriteProduct = (rows: readonly SafeReservationRow[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (
      row.reservationState === "cancelled" ||
      row.reservationState === "hold_expired"
    ) {
      continue;
    }
    const label = getReservationTypeLabel(row);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    [...counts.entries()].toSorted(
      ([leftLabel, leftCount], [rightLabel, rightCount]) =>
        rightCount - leftCount || leftLabel.localeCompare(rightLabel)
    )[0]?.[0] ?? null
  );
};

const getReservationTypeLabel = (row: SafeReservationRow) => {
  if (row.reservationDetails.kind === "meeting-room") return "Meeting Room";
  const tier = row.reservationDetails.entryTier;
  return `Cowork ${tier[0]?.toUpperCase()}${tier.slice(1)}`;
};

const getReservationDate = (startsAt: string) =>
  Temporal.Instant.from(startsAt)
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

type LiveReservationDetails = {
  readonly reservation: DotyposReservation | null;
  readonly customer: DotyposCustomer | null;
};

const toReservationSummary = ({
  latestPayment = null,
  live,
  row,
}: {
  readonly latestPayment?: AdministrationPaymentAttempt | null;
  readonly live: LiveReservationDetails;
  readonly row: SafeReservationRow;
}): AdministrationReservationSummary => {
  return {
    id: row.id,
    customerId: row.dotyposCustomerId,
    customer: live.customer
      ? toCustomer(live.customer, row.dotyposCustomerId)
      : null,
    liveDetailsAvailable: Boolean(live.reservation),
    startsAt: live.reservation?.startDate ?? null,
    endsAt: live.reservation?.endDate ?? null,
    date: live.reservation
      ? getReservationDate(live.reservation.startDate)
      : null,
    type: row.reservationDetails.kind,
    typeLabel: getReservationTypeLabel(row),
    status: getAdministrationReservationStatus({
      dotyposStatus: live.reservation?.status,
      fulfillmentState: row.fulfillmentState,
      paymentState: row.paymentState,
      reservationState: row.reservationState,
    }),
    createdAt: toIsoString(row.createdAt),
    latestPayment,
    updatedAt: toIsoString(row.updatedAt),
  };
};

const bookingStatusLabels = {
  NEW: "New",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
} as const;

const toBookingSummary = ({
  booking,
  customer,
  row,
  table,
}: {
  readonly booking: DotyposReservation & { readonly id: string };
  readonly customer: DotyposCustomer | null;
  readonly row: SafeReservationRow | null;
  readonly table: DotyposTable | null;
}): AdministrationBookingSummary => ({
  id: booking.id,
  customerId: booking._customerId ?? null,
  customer:
    booking._customerId && customer
      ? toCustomer(customer, booking._customerId)
      : null,
  startsAt: booking.startDate,
  endsAt: booking.endDate,
  seats: booking.seats,
  status: booking.status,
  statusLabel: bookingStatusLabels[booking.status],
  tableId: booking._tableId ?? null,
  tableName: table?.name ?? null,
  tableLocation: table?.locationName ?? null,
  linkedReservation: row
    ? { id: row.id, label: getReservationTypeLabel(row) }
    : null,
  createdAt: booking.created ?? null,
  updatedAt: booking.versionDate ?? null,
});

const getDateRangeBounds = (startDate: string, endDate: string) => {
  const start = Temporal.PlainDate.from(startDate).toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  const end = Temporal.PlainDate.from(endDate).toZonedDateTime({
    plainTime: Temporal.PlainTime.from("00:00"),
    timeZone: workspaceSiteConstants.location.timeZone,
  });
  return {
    startsAtOrAfter: start.toInstant().toString(),
    startsBefore: end.toInstant().toString(),
  };
};

const getDateBounds = (date: string) => {
  const plainDate = Temporal.PlainDate.from(date);
  return getDateRangeBounds(date, plainDate.add({ days: 1 }).toString());
};

const buildTimeline = (row: SafeReservationRow) => {
  const items: AdministrationTimelineItem[] = [
    {
      id: "workflow-created",
      title: "Checkout workflow created",
      description: "Deskohub created the local reservation workflow.",
      occurredAt: toIsoString(row.createdAt),
      tone: "neutral",
    },
  ];
  const add = (
    id: string,
    title: string,
    description: string,
    occurredAt: Temporal.Instant | null,
    tone: AdministrationTimelineItem["tone"]
  ) => {
    if (occurredAt) {
      items.push({
        id,
        title,
        description,
        occurredAt: toIsoString(occurredAt),
        tone,
      });
    }
  };
  add(
    "reservation-created",
    "Reservation held",
    "The booking was held for the customer.",
    row.reservationCreatedAt,
    "neutral"
  );
  add(
    "payment-paid",
    "Payment recorded by Deskohub",
    "Deskohub verified the provider payment and marked the reservation paid.",
    row.paidAt,
    "positive"
  );
  add(
    "reservation-confirmed",
    "Reservation confirmed",
    "The reservation was confirmed.",
    row.reservationConfirmedAt,
    "positive"
  );
  add(
    "fulfilled",
    "Customer access sent",
    "The customer confirmation was delivered.",
    row.fulfilledAt,
    "positive"
  );
  add(
    "fulfillment-failed",
    "Customer confirmation failed",
    "The confirmation could not be completed.",
    row.fulfillmentFailedAt,
    "warning"
  );
  add(
    "hold-expired",
    "Reservation hold expired",
    "The held reservation reached its expiry time.",
    row.reservationHoldExpiredAt,
    "warning"
  );
  add(
    "cancelled",
    "Reservation cancelled",
    "The held reservation was cancelled.",
    row.reservationCancelledAt,
    "warning"
  );
  return items.toSorted((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt)
  );
};

const buildPaymentAttemptTimeline = (
  attempts: readonly AdministrationPaymentAttempt[]
): readonly AdministrationTimelineItem[] =>
  attempts.flatMap((attempt) => {
    const started: AdministrationTimelineItem = {
      id: `payment-attempt-${attempt.id}-started`,
      title: "Payment started",
      description: `${attempt.providerLabel} attempt ${attempt.id}.`,
      occurredAt: attempt.createdAt,
      tone: "neutral",
    };
    if (
      attempt.state === "created" ||
      attempt.state === "pending" ||
      attempt.state === "paid"
    ) {
      return [started];
    }
    return [
      started,
      {
        id: `payment-attempt-${attempt.id}-${attempt.state}`,
        title: {
          cancelled: "Payment unsuccessful",
          expired: "Payment unsuccessful",
          failed: "Payment failed",
        }[attempt.state],
        description: "The attempt ended without a recorded payment.",
        occurredAt: attempt.updatedAt,
        tone: "warning" as const,
      },
    ];
  });

const getOperationTimelineTitle = (
  operationType: string | undefined,
  operationResult: string | undefined
) => {
  if (operationType === "AUTHORIZATION" && operationResult === "AUTHORIZED") {
    return "Payment authorized by Nexi";
  }
  if (
    (operationType === "AUTHORIZATION" || operationType === "CAPTURE") &&
    operationResult === "EXECUTED"
  ) {
    return "Payment executed by Nexi";
  }
  if (operationType === "REFUND") return "Refund reported by Nexi";
  if (operationType === "CANCEL" || operationType === "VOID") {
    return "Payment reversal reported by Nexi";
  }
  const typeLabel = operationType
    ? getProviderValueLabel(operationType)
    : "Payment operation";
  return operationResult
    ? `${typeLabel}: ${getProviderValueLabel(operationResult)}`
    : typeLabel;
};

const getOrderTimeline = (
  orders: readonly AdministrationOrder[]
): readonly AdministrationTimelineItem[] => {
  const items: AdministrationTimelineItem[] = [];
  for (const order of orders) {
    if (order.link?.providerOrderCreatedAt) {
      items.push({
        id: `order-${order.orderId}-created`,
        title: order.link.providerOrderCreatedAtEstimated
          ? "Nexi order created (estimated)"
          : "Nexi order created",
        description: order.link.providerOrderCreatedAtEstimated
          ? "This attached Nexi session predates exact order-creation tracking; the local payment-attempt time is shown."
          : "Nexi accepted the hosted-payment request.",
        occurredAt: order.link.providerOrderCreatedAt,
        tone: "neutral",
        href: `#order-${order.orderId}`,
      });
    }
    for (const [index, operation] of (
      order.provider?.operations ?? []
    ).entries()) {
      if (!operation.operationTime) continue;
      let occurredAt: string;
      try {
        occurredAt = Temporal.Instant.from(operation.operationTime).toString();
      } catch {
        continue;
      }
      const result = operation.operationResult?.toUpperCase();
      const operationId = operation.operationId;
      items.push({
        id: operationId
          ? `nexi-operation-${operationId}`
          : `nexi-operation-${order.orderId}-${index}`,
        title: getOperationTimelineTitle(
          operation.operationType?.toUpperCase(),
          result
        ),
        description: operation.channel
          ? `Nexi reported this ${getProviderValueLabel(operation.channel)} operation.`
          : "Nexi reported this payment operation.",
        occurredAt,
        tone: getProviderOperationTimelineTone(
          operation.operationType,
          operation.operationResult
        ),
        ...(operationId && {
          href: `#operation-${operationId}`,
        }),
      });
    }
  }
  return items;
};

export class AdministrationService extends Context.Service<
  AdministrationService,
  {
    readonly loadOverview: () => Effect.Effect<
      {
        readonly today: AdministrationOverviewMetric;
        readonly upcoming: AdministrationOverviewMetric;
        readonly lastSevenDays: AdministrationOverviewMetric;
      },
      unknown
    >;
    readonly listReservations: (
      input: AdministrationReservationListInput
    ) => Effect.Effect<
      AdministrationReservationPage & {
        readonly dateFilterUnavailable: boolean;
        readonly statusFilterUnavailable: boolean;
      },
      unknown
    >;
    readonly loadReservation: (
      id: string
    ) => Effect.Effect<AdministrationReservationDetail | null, unknown>;
    readonly findReservationId: (
      identifier: string
    ) => Effect.Effect<string | null, unknown>;
    readonly listBookings: (input: {
      readonly date: string;
      readonly page?: number;
    }) => Effect.Effect<AdministrationBookingPage, unknown>;
    readonly loadBooking: (
      id: string
    ) => Effect.Effect<AdministrationBookingDetail | null, unknown>;
    readonly listCustomers: (
      input: AdministrationCustomerListInput
    ) => Effect.Effect<
      {
        readonly items: readonly AdministrationCustomerSummary[];
        readonly page: number;
        readonly pageCount: number;
        readonly total: number;
      },
      unknown
    >;
    readonly loadCustomerReservations: (input: {
      readonly customerId: string;
      readonly page?: number;
    }) => Effect.Effect<AdministrationReservationPage, unknown>;
    readonly loadCustomerActivity: (
      customerId: string
    ) => Effect.Effect<AdministrationCustomerActivity, unknown>;
    readonly listOrders: IPaymentAdministrationService["listOrders"];
    readonly loadOrder: IPaymentAdministrationService["loadOrder"];
    readonly listOperations: IPaymentAdministrationService["listOperations"];
    readonly loadOperation: IPaymentAdministrationService["loadOperation"];
  }
>()("@deskohub-workspace/administration/AdministrationService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const reservationHistory = yield* PostHogReservationHistory;
      const paymentAdministration = yield* PaymentAdministrationService;

      const loadLiveReservation = Effect.fn(
        "AdministrationService.loadLiveReservation"
      )((row: SafeReservationRow): Effect.Effect<LiveReservationDetails> => {
        const loadCustomer = dotypos.getCustomer(row.dotyposCustomerId).pipe(
          Effect.map(
            (customer): LiveReservationDetails => ({
              reservation: null,
              customer,
            })
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Live customer details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.as({ reservation: null, customer: null } as const))
          )
        );

        if (!row.dotyposReservationId) return loadCustomer;

        return dotypos.getReservation(row.dotyposReservationId).pipe(
          Effect.map(
            ({ customer, reservation }): LiveReservationDetails => ({
              customer,
              reservation,
            })
          ),
          Effect.catch((cause) =>
            Effect.logWarning("Live booking details unavailable", {
              cause,
              workspaceReservationId: row.id,
            }).pipe(Effect.andThen(loadCustomer))
          )
        );
      });

      const enrichRows = Effect.fn("AdministrationService.enrichRows")(
        function* (
          rows: readonly SafeReservationRow[],
          projectedReservations?: ReadonlyMap<string, DotyposReservation>
        ) {
          if (rows.length === 0) return [];
          const attemptRows = yield* db
            .select(safePaymentAttemptSelection)
            .from(paymentAttempts)
            .where(
              inArray(
                paymentAttempts.workspaceReservationId,
                rows.map(({ id }) => id)
              )
            )
            .orderBy(desc(paymentAttempts.createdAt));
          const latestPaymentByReservation = new Map<
            string,
            AdministrationPaymentAttempt
          >();
          for (const attempt of attemptRows) {
            if (
              !latestPaymentByReservation.has(attempt.workspaceReservationId)
            ) {
              latestPaymentByReservation.set(
                attempt.workspaceReservationId,
                toAdministrationPaymentAttempt(attempt)
              );
            }
          }
          return yield* Effect.all(
            rows.map((row) => {
              const live = loadLiveReservation(row).pipe(
                Effect.map((details) =>
                  projectedReservations && row.dotyposReservationId
                    ? {
                        ...details,
                        reservation:
                          projectedReservations.get(row.dotyposReservationId) ??
                          null,
                      }
                    : details
                )
              );
              return live.pipe(
                Effect.map((details) =>
                  toReservationSummary({
                    latestPayment:
                      latestPaymentByReservation.get(row.id) ?? null,
                    live: details,
                    row,
                  })
                )
              );
            }),
            { concurrency: 5 }
          );
        }
      );

      const loadBookingTables = () =>
        dotypos.getTables().pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Booking table details unavailable", {
              cause,
            }).pipe(Effect.as([] as const))
          )
        );

      const loadDateReservationMap = (date?: string) => {
        if (!date) return Effect.succeed(undefined);
        return Effect.try({
          try: () => getDateBounds(date),
          catch: () => undefined,
        }).pipe(
          Effect.flatMap((bounds) =>
            bounds
              ? dotypos
                  .listReservations({
                    ...bounds,
                    order: "startDateAscending",
                  })
                  .pipe(
                    Effect.map(
                      (reservations) =>
                        new Map(
                          reservations.flatMap((reservation) =>
                            reservation.id
                              ? [[reservation.id, reservation] as const]
                              : []
                          )
                        )
                    ),
                    Effect.catch((cause) =>
                      Effect.logWarning("Reservation date filter unavailable", {
                        cause,
                        date,
                      }).pipe(Effect.as(null))
                    )
                  )
              : Effect.succeed(null)
          )
        );
      };

      const loadReservationPeriodCount = Effect.fn(
        "AdministrationService.loadReservationPeriodCount"
      )(function* (input: {
        readonly startDate: string;
        readonly endDate: string;
        readonly linkedReservationIds: ReadonlySet<string>;
      }) {
        const reservations = yield* dotypos
          .listReservations({
            ...getDateRangeBounds(input.startDate, input.endDate),
            order: "startDateAscending",
          })
          .pipe(
            Effect.map((items) => ({ kind: "available" as const, items })),
            Effect.catch((cause) =>
              Effect.logWarning("Reservation overview period unavailable", {
                cause,
                endDate: input.endDate,
                startDate: input.startDate,
              }).pipe(Effect.as({ kind: "unavailable" as const }))
            )
          );
        if (reservations.kind === "unavailable") {
          return { unavailable: true, value: 0 };
        }
        return {
          unavailable: false,
          value: new Set(
            reservations.items.flatMap(({ id }) =>
              id && input.linkedReservationIds.has(id) ? [id] : []
            )
          ).size,
        };
      });

      const listReservations = Effect.fn(
        "AdministrationService.listReservations"
      )(function* (input: ReservationListInput) {
        const pageSize = input.pageSize ?? reservationPageSize;
        const dateReservations = yield* loadDateReservationMap(input.date);
        const conditions: SQL[] = [];
        if (input.customerId) {
          conditions.push(
            eq(workspaceReservations.dotyposCustomerId, input.customerId)
          );
        }
        if (input.type) {
          conditions.push(
            sql`${workspaceReservations.reservationDetails}->>'kind' = ${input.type}`
          );
        }
        if (input.date) {
          const ids = dateReservations ? [...dateReservations.keys()] : [];
          conditions.push(
            ids.length > 0
              ? inArray(workspaceReservations.dotyposReservationId, ids)
              : sql`false`
          );
        }
        const where = conditions.length > 0 ? and(...conditions) : undefined;

        if (input.status) {
          const projectedReservations =
            dateReservations !== undefined
              ? dateReservations
              : yield* dotypos
                  .listReservations({ order: "startDateDescending" })
                  .pipe(
                    Effect.map(
                      (reservations) =>
                        new Map(
                          reservations.flatMap((reservation) =>
                            reservation.id
                              ? [[reservation.id, reservation] as const]
                              : []
                          )
                        )
                    ),
                    Effect.catch((cause) =>
                      Effect.logWarning(
                        "Live reservation status filter unavailable",
                        { cause }
                      ).pipe(Effect.as(null))
                    )
                  );
          if (projectedReservations === null) {
            return {
              items: [],
              page: 1,
              pageCount: 1,
              total: 0,
              dateFilterUnavailable: Boolean(input.date),
              statusFilterUnavailable: true,
            };
          }
          const candidateRows = yield* db
            .select(safeReservationSelection)
            .from(workspaceReservations)
            .where(where)
            .orderBy(desc(workspaceReservations.updatedAt));
          const matchingRows = filterAdministrationReservationsByStatus(
            candidateRows,
            input.status,
            new Map(
              [...projectedReservations].map(([id, reservation]) => [
                id,
                reservation.status,
              ])
            )
          );
          const total = matchingRows.length;
          const pagination = getAdministrationPagination({
            pageSize,
            requestedPage: input.page,
            total,
          });
          const rows = matchingRows.slice(
            pagination.offset,
            pagination.offset + pageSize
          );
          return {
            items: yield* enrichRows(rows, projectedReservations),
            page: pagination.page,
            pageCount: pagination.pageCount,
            total,
            dateFilterUnavailable: false,
            statusFilterUnavailable: false,
          };
        }

        const countRows = yield* db
          .select({ value: count() })
          .from(workspaceReservations)
          .where(where);
        const total = Number(countRows[0]?.value ?? 0);
        const pagination = getAdministrationPagination({
          pageSize,
          requestedPage: input.page,
          total,
        });
        const rows = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(where)
          .orderBy(desc(workspaceReservations.updatedAt))
          .limit(pageSize)
          .offset(pagination.offset);
        return {
          items: yield* enrichRows(rows),
          page: pagination.page,
          pageCount: pagination.pageCount,
          total,
          dateFilterUnavailable: Boolean(
            input.date && dateReservations === null
          ),
          statusFilterUnavailable: false,
        };
      });

      const loadReservation = Effect.fn(
        "AdministrationService.loadReservation"
      )(function* (id: string) {
        const [row] = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
          .limit(1);
        if (!row) return null;

        const {
          applicationRows,
          attemptRows,
          history,
          live,
          orders,
          otherRows,
          tables,
        } = yield* Effect.all(
          {
            applicationRows: db
              .select({
                id: discountApplications.id,
                label: discountApplications.label,
                appliedAmountValue: discountApplications.appliedAmountValue,
                appliedAmountExponent:
                  discountApplications.appliedAmountExponent,
                appliedAmountCurrency:
                  discountApplications.appliedAmountCurrency,
              })
              .from(discountApplications)
              .where(eq(discountApplications.workspaceReservationId, row.id))
              .orderBy(discountApplications.sequence),
            attemptRows: db
              .select(safePaymentAttemptSelection)
              .from(paymentAttempts)
              .where(eq(paymentAttempts.workspaceReservationId, row.id))
              .orderBy(paymentAttempts.createdAt),
            history: reservationHistory.load(row.id),
            live: loadLiveReservation(row),
            orders: paymentAdministration.loadReservationOrders(row.id),
            tables: loadBookingTables(),
            otherRows: db
              .select(safeReservationSelection)
              .from(workspaceReservations)
              .where(
                and(
                  eq(
                    workspaceReservations.dotyposCustomerId,
                    row.dotyposCustomerId
                  ),
                  sql`${workspaceReservations.id} <> ${row.id}`
                )
              )
              .orderBy(desc(workspaceReservations.updatedAt))
              .limit(4),
          },
          { concurrency: 7 }
        );

        let sameDateRows: readonly SafeReservationRow[] = [];
        if (live.reservation) {
          const date = getReservationDate(live.reservation.startDate);
          const dateReservations = yield* loadDateReservationMap(date);
          const reservationIds = dateReservations
            ? [...dateReservations.keys()].filter(
                (reservationId) => reservationId !== row.dotyposReservationId
              )
            : [];
          if (reservationIds.length > 0) {
            sameDateRows = yield* db
              .select(safeReservationSelection)
              .from(workspaceReservations)
              .where(
                inArray(
                  workspaceReservations.dotyposReservationId,
                  reservationIds
                )
              )
              .orderBy(desc(workspaceReservations.updatedAt))
              .limit(4);
          }
        }

        const { otherCustomerReservations, sameDateReservations } =
          yield* Effect.all(
            {
              otherCustomerReservations: enrichRows(otherRows),
              sameDateReservations: enrichRows(sameDateRows),
            },
            { concurrency: 2 }
          );

        const attempts = attemptRows.map(toAdministrationPaymentAttempt);
        const table = live.reservation?._tableId
          ? (tables.find(
              ({ id: tableId }) => tableId === live.reservation?._tableId
            ) ?? null)
          : null;

        return {
          reservation: toReservationSummary({
            latestPayment: attempts.at(-1) ?? null,
            live,
            row,
          }),
          booking:
            live.reservation && row.dotyposReservationId
              ? toBookingSummary({
                  booking: {
                    ...live.reservation,
                    id: row.dotyposReservationId,
                  },
                  customer: live.customer,
                  row,
                  table,
                })
              : null,
          lifecycle: getAdministrationReservationLifecycle({
            dotyposStatus: live.reservation?.status,
            fulfillmentState: row.fulfillmentState,
            paymentState: row.paymentState,
            reservationState: row.reservationState,
          }),
          timeline: mergeReservationHistory({
            durable: [
              ...buildTimeline(row),
              ...buildPaymentAttemptTimeline(attempts),
              ...getOrderTimeline(orders),
            ],
            history,
          }),
          paymentAttempts: attempts,
          orders,
          discounts: applicationRows.map((application) => ({
            id: application.id,
            label: application.label,
            amount: {
              value: application.appliedAmountValue,
              exponent: application.appliedAmountExponent,
              currency: application.appliedAmountCurrency,
            },
          })),
          otherCustomerReservations,
          sameDateReservations,
          references: {
            workspaceReservationId: row.id,
            dotyposReservationId: row.dotyposReservationId,
            customerId: row.dotyposCustomerId,
          },
        } satisfies AdministrationReservationDetail;
      });

      const findReservationId = Effect.fn(
        "AdministrationService.findReservationId"
      )(function* (identifier: string) {
        const {
          applicationRows,
          evidenceRows,
          paymentRows,
          reservationRows,
          webhookRows,
        } = yield* Effect.all(
          {
            reservationRows: db
              .selectDistinct({ reservationId: workspaceReservations.id })
              .from(workspaceReservations)
              .where(
                or(
                  eq(workspaceReservations.id, identifier),
                  eq(workspaceReservations.checkoutSessionKey, identifier),
                  eq(workspaceReservations.checkoutAttemptKey, identifier),
                  eq(workspaceReservations.correlationId, identifier),
                  eq(workspaceReservations.dotyposReservationId, identifier),
                  eq(workspaceReservations.activePaymentAttemptId, identifier)
                )
              )
              .limit(2),
            paymentRows: db
              .selectDistinct({
                reservationId: paymentAttempts.workspaceReservationId,
              })
              .from(paymentAttempts)
              .where(
                or(
                  eq(paymentAttempts.id, identifier),
                  eq(paymentAttempts.providerOrderId, identifier),
                  eq(paymentAttempts.lastWebhookEventId, identifier),
                  eq(paymentAttempts.lastProviderOperationId, identifier)
                )
              )
              .limit(2),
            applicationRows: db
              .selectDistinct({
                reservationId: discountApplications.workspaceReservationId,
              })
              .from(discountApplications)
              .where(sql`${discountApplications.id} = ${identifier}`)
              .limit(2),
            evidenceRows: db
              .selectDistinct({
                reservationId: legalEvidenceEvents.workspaceReservationId,
              })
              .from(legalEvidenceEvents)
              .where(eq(legalEvidenceEvents.id, identifier))
              .limit(2),
            webhookRows: db
              .selectDistinct({
                reservationId: paymentAttempts.workspaceReservationId,
              })
              .from(webhookEvents)
              .innerJoin(
                paymentAttempts,
                or(
                  eq(webhookEvents.paymentAttemptId, paymentAttempts.id),
                  eq(
                    webhookEvents.providerOrderId,
                    paymentAttempts.providerOrderId
                  )
                )
              )
              .where(
                or(
                  eq(webhookEvents.id, identifier),
                  eq(webhookEvents.eventId, identifier),
                  eq(webhookEvents.providerOrderId, identifier)
                )
              )
              .limit(2),
          },
          { concurrency: 5 }
        );

        return getUniqueReservationId([
          ...reservationRows.map(({ reservationId }) => reservationId),
          ...paymentRows.map(({ reservationId }) => reservationId),
          ...applicationRows.map(({ reservationId }) => reservationId),
          ...evidenceRows.map(({ reservationId }) => reservationId),
          ...webhookRows.map(({ reservationId }) => reservationId),
        ]);
      });

      const listBookings = Effect.fn("AdministrationService.listBookings")(
        function* (input: { readonly date: string; readonly page?: number }) {
          const bookings = (yield* dotypos.listReservations({
            ...getDateBounds(input.date),
            order: "startDateAscending",
          })).flatMap((booking) =>
            booking.id ? [{ ...booking, id: booking.id }] : []
          );
          const pagination = getAdministrationPagination({
            pageSize: bookingPageSize,
            requestedPage: input.page,
            total: bookings.length,
          });
          const pageBookings = bookings.slice(
            pagination.offset,
            pagination.offset + bookingPageSize
          );
          const bookingIds = pageBookings.map(({ id }) => id);
          const { customers, rows, tables } = yield* Effect.all(
            {
              customers: Effect.all(
                pageBookings.map((booking) =>
                  booking._customerId
                    ? dotypos.getCustomer(booking._customerId).pipe(
                        Effect.map(
                          (customer) => [booking.id, customer] as const
                        ),
                        Effect.catch(() =>
                          Effect.succeed([booking.id, null] as const)
                        )
                      )
                    : Effect.succeed([booking.id, null] as const)
                ),
                { concurrency: 5 }
              ),
              rows:
                bookingIds.length > 0
                  ? db
                      .select(safeReservationSelection)
                      .from(workspaceReservations)
                      .where(
                        inArray(
                          workspaceReservations.dotyposReservationId,
                          bookingIds
                        )
                      )
                  : Effect.succeed([] as readonly SafeReservationRow[]),
              tables: loadBookingTables(),
            },
            { concurrency: 3 }
          );
          const customersByBookingId = new Map(customers);
          const rowsByBookingId = new Map(
            rows.flatMap((row) =>
              row.dotyposReservationId
                ? [[row.dotyposReservationId, row] as const]
                : []
            )
          );
          const tablesById = new Map(
            tables.flatMap((table) =>
              table.id ? [[table.id, table] as const] : []
            )
          );

          return {
            items: pageBookings.map((booking) =>
              toBookingSummary({
                booking,
                customer: customersByBookingId.get(booking.id) ?? null,
                row: rowsByBookingId.get(booking.id) ?? null,
                table: booking._tableId
                  ? (tablesById.get(booking._tableId) ?? null)
                  : null,
              })
            ),
            page: pagination.page,
            pageCount: pagination.pageCount,
            total: bookings.length,
          } satisfies AdministrationBookingPage;
        }
      );

      const loadBooking = Effect.fn("AdministrationService.loadBooking")(
        function* (id: string) {
          const [details, tables] = yield* Effect.all(
            [
              dotypos
                .getReservation(id)
                .pipe(
                  Effect.catchTag("ExternalAPIError", (error) =>
                    error.statusCode === 404
                      ? Effect.succeed(null)
                      : Effect.fail(error)
                  )
                ),
              loadBookingTables(),
            ],
            { concurrency: 2 }
          );
          if (!details) return null;
          const { customer, reservation } = details;
          const [row] = yield* db
            .select(safeReservationSelection)
            .from(workspaceReservations)
            .where(eq(workspaceReservations.dotyposReservationId, id))
            .limit(1);
          const table = reservation._tableId
            ? (tables.find(
                ({ id: tableId }) => tableId === reservation._tableId
              ) ?? null)
            : null;
          const booking = toBookingSummary({
            booking: { ...reservation, id },
            customer,
            row: row ?? null,
            table,
          });

          return {
            booking,
            references: {
              bookingId: id,
              customerId: booking.customerId,
              workspaceReservationId: booking.linkedReservation?.id ?? null,
            },
          } satisfies AdministrationBookingDetail;
        }
      );

      const listCustomers = Effect.fn("AdministrationService.listCustomers")(
        function* (input: AdministrationCustomerListInput) {
          const countRows = yield* db
            .select({
              value: countDistinct(workspaceReservations.dotyposCustomerId),
            })
            .from(workspaceReservations);
          const total = Number(countRows[0]?.value ?? 0);
          const pagination = getAdministrationPagination({
            pageSize: customerPageSize,
            requestedPage: input.page,
            total,
          });
          const rows = yield* db
            .select({
              customerId: workspaceReservations.dotyposCustomerId,
              reservationCount: count(),
              lastActivityAt: max(workspaceReservations.updatedAt),
            })
            .from(workspaceReservations)
            .groupBy(workspaceReservations.dotyposCustomerId)
            .orderBy(desc(max(workspaceReservations.updatedAt)))
            .limit(customerPageSize)
            .offset(pagination.offset);
          const items = yield* Effect.all(
            rows.map((row) =>
              dotypos.getCustomer(row.customerId).pipe(
                Effect.map((customer) => toCustomer(customer, row.customerId)),
                Effect.catch(() => Effect.succeed(null)),
                Effect.map((customer) => ({
                  customer,
                  customerId: row.customerId,
                  reservationCount: Number(row.reservationCount),
                  lastActivityAt: row.lastActivityAt
                    ? toIsoString(row.lastActivityAt)
                    : Temporal.Instant.fromEpochMilliseconds(0).toString(),
                }))
              )
            ),
            { concurrency: 5 }
          );
          return {
            items,
            page: pagination.page,
            pageCount: pagination.pageCount,
            total,
          };
        }
      );

      const loadCustomerReservations = Effect.fn(
        "AdministrationService.loadCustomerReservations"
      )(function* (input: {
        readonly customerId: string;
        readonly page?: number;
      }) {
        const where = eq(
          workspaceReservations.dotyposCustomerId,
          input.customerId
        );
        const countRows = yield* db
          .select({ value: count() })
          .from(workspaceReservations)
          .where(where);
        const total = Number(countRows[0]?.value ?? 0);
        const pagination = getAdministrationPagination({
          pageSize: customerReservationPageSize,
          requestedPage: input.page,
          total,
        });
        const rows = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(where)
          .orderBy(desc(workspaceReservations.updatedAt))
          .limit(customerReservationPageSize)
          .offset(pagination.offset);
        return {
          items: yield* enrichRows(rows),
          page: pagination.page,
          pageCount: pagination.pageCount,
          total,
        };
      });

      const loadCustomerActivity = Effect.fn(
        "AdministrationService.loadCustomerActivity"
      )(function* (customerId: string) {
        const rows = yield* db
          .select(safeReservationSelection)
          .from(workspaceReservations)
          .where(eq(workspaceReservations.dotyposCustomerId, customerId))
          .orderBy(desc(workspaceReservations.updatedAt));

        if (rows.length === 0) {
          return {
            reservations: [],
            transactions: [],
            stats: {
              reservationCount: 0,
              favoriteProduct: null,
              revenue: [],
              discountSavings: [],
            },
            consents: [],
          } satisfies AdministrationCustomerActivity;
        }

        const reservationIds = rows.map(({ id }) => id);
        const { applicationRows, attemptRows, evidenceRows, liveReservations } =
          yield* Effect.all(
            {
              attemptRows: db
                .select(safePaymentAttemptSelection)
                .from(paymentAttempts)
                .where(
                  inArray(
                    paymentAttempts.workspaceReservationId,
                    reservationIds
                  )
                )
                .orderBy(desc(paymentAttempts.createdAt)),
              applicationRows: db
                .select({
                  value: discountApplications.appliedAmountValue,
                  exponent: discountApplications.appliedAmountExponent,
                  currency: discountApplications.appliedAmountCurrency,
                })
                .from(discountApplications)
                .innerJoin(
                  paymentAttempts,
                  eq(discountApplications.paymentAttemptId, paymentAttempts.id)
                )
                .where(
                  and(
                    inArray(
                      discountApplications.workspaceReservationId,
                      reservationIds
                    ),
                    eq(paymentAttempts.state, "paid")
                  )
                ),
              evidenceRows: db
                .select({
                  accepted: legalEvidenceEvents.accepted,
                  acceptedAt: legalEvidenceEvents.acceptedAt,
                  documentHash: legalEvidenceEvents.documentHash,
                  documentKey: legalEvidenceEvents.documentKey,
                  documentPath: legalEvidenceEvents.documentPath,
                  locale: legalEvidenceEvents.locale,
                })
                .from(legalEvidenceEvents)
                .where(
                  and(
                    inArray(
                      legalEvidenceEvents.workspaceReservationId,
                      reservationIds
                    ),
                    inArray(legalEvidenceEvents.documentKey, [
                      "privacyPolicy",
                      "marketingCommunications",
                    ])
                  )
                )
                .orderBy(desc(legalEvidenceEvents.acceptedAt)),
              liveReservations: dotypos
                .listReservations({
                  customerId,
                  order: "startDateDescending",
                })
                .pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning(
                      "Customer reservation dates unavailable",
                      { cause, customerId }
                    ).pipe(Effect.as([] as const))
                  )
                ),
            },
            { concurrency: 4 }
          );

        const liveById = new Map(
          liveReservations.flatMap((reservation) =>
            reservation.id ? [[reservation.id, reservation] as const] : []
          )
        );
        const latestPaymentByReservation = new Map<
          string,
          AdministrationPaymentAttempt
        >();
        for (const attempt of attemptRows) {
          if (!latestPaymentByReservation.has(attempt.workspaceReservationId)) {
            latestPaymentByReservation.set(
              attempt.workspaceReservationId,
              toAdministrationPaymentAttempt(attempt)
            );
          }
        }
        const reservations = rows.map((row) =>
          toReservationSummary({
            latestPayment: latestPaymentByReservation.get(row.id) ?? null,
            live: {
              customer: null,
              reservation: row.dotyposReservationId
                ? (liveById.get(row.dotyposReservationId) ?? null)
                : null,
            },
            row,
          })
        );
        const reservationsById = new Map(
          reservations.map((reservation) => [reservation.id, reservation])
        );
        const latestConsentByKey = new Map<
          AdministrationCustomerConsent["documentKey"],
          AdministrationCustomerConsent
        >();
        for (const evidence of evidenceRows) {
          if (
            evidence.documentKey !== "privacyPolicy" &&
            evidence.documentKey !== "marketingCommunications"
          ) {
            continue;
          }
          if (!latestConsentByKey.has(evidence.documentKey)) {
            latestConsentByKey.set(evidence.documentKey, {
              ...evidence,
              documentKey: evidence.documentKey,
              acceptedAt: toIsoString(evidence.acceptedAt),
            });
          }
        }

        return {
          reservations,
          transactions: attemptRows.flatMap((row) => {
            const reservation = reservationsById.get(
              row.workspaceReservationId
            );
            return reservation
              ? [
                  {
                    attempt: toAdministrationPaymentAttempt(row),
                    reservation,
                  },
                ]
              : [];
          }),
          stats: {
            reservationCount: rows.length,
            favoriteProduct: getFavoriteProduct(rows),
            revenue: sumMoney(
              attemptRows.flatMap((attempt) =>
                attempt.state === "paid"
                  ? [
                      {
                        value: attempt.amountValue,
                        exponent: attempt.amountExponent,
                        currency: attempt.currency,
                      },
                    ]
                  : []
              )
            ),
            discountSavings: sumMoney(applicationRows),
          },
          consents: [...latestConsentByKey.values()],
        } satisfies AdministrationCustomerActivity;
      });

      const loadOverview = Effect.fn("AdministrationService.loadOverview")(
        function* () {
          const currentDate = getCurrentWorkspaceDate();
          const tomorrow = currentDate.add({ days: 1 });
          const linkedRows = yield* db
            .select({ id: workspaceReservations.dotyposReservationId })
            .from(workspaceReservations)
            .where(isNotNull(workspaceReservations.dotyposReservationId));
          const linkedReservationIds = new Set(
            linkedRows.flatMap(({ id }) => (id ? [id] : []))
          );
          const { lastSevenDays, today, upcoming } = yield* Effect.all(
            {
              today: loadReservationPeriodCount({
                startDate: currentDate.toString(),
                endDate: tomorrow.toString(),
                linkedReservationIds,
              }),
              upcoming: loadReservationPeriodCount({
                startDate: tomorrow.toString(),
                endDate: currentDate.add({ days: 31 }).toString(),
                linkedReservationIds,
              }),
              lastSevenDays: loadReservationPeriodCount({
                startDate: currentDate.subtract({ days: 6 }).toString(),
                endDate: tomorrow.toString(),
                linkedReservationIds,
              }),
            },
            { concurrency: 3 }
          );
          return { today, upcoming, lastSevenDays };
        }
      );

      return {
        loadOverview,
        listReservations,
        loadReservation,
        findReservationId,
        listBookings,
        loadBooking,
        listCustomers,
        loadCustomerReservations,
        loadCustomerActivity,
        listOrders: paymentAdministration.listOrders,
        loadOrder: paymentAdministration.loadOrder,
        listOperations: paymentAdministration.listOperations,
        loadOperation: paymentAdministration.loadOperation,
      };
    })
  );
}
